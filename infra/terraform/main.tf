# =============================================================================
# Provisionamento dos microserviços.
#
# Terraform é a **única** coisa que cria ou muda recurso. O Serverless Framework
# é emulador local e packager — ver docs/adr/0002.
#
# Um serviço novo entra em `local.services` e nada mais precisa mudar aqui.
# =============================================================================

# Resolve a conta em uso. No LocalStack devolve a conta fictícia padrão; em AWS
# real, a da credencial — o mesmo HCL serve aos dois sem valor fixo.
data "aws_caller_identity" "current" {}

locals {
  name = "${var.project_name}-${var.env_suffix}"

  # Registro dos microserviços. O `route_prefix` casa com o `ROUTE_PREFIX` do
  # router de cada um — a paridade é verificada por `pnpm check:routes`.
  services = {
    bliss-requests = { route_prefix = "requests" }
    bliss-reviews  = { route_prefix = "reviews" }
  }

  # Variáveis de ambiente comuns. A credencial do banco **não** está aqui: só o
  # id do segredo, que a função resolve em runtime.
  common_environment = {
    BLISS_ENV    = var.env_suffix
    LOG_LEVEL    = var.log_level
    API_PREFIX   = var.api_prefix
    DB_SECRET_ID = module.database.secret_id
    DB_POOL_MAX  = tostring(var.db_pool_max)
    DB_SSL       = var.use_localstack ? "false" : "true"
    # Endpoint **interno**: quem lê esta variável é a Lambda, de dentro da rede.
    AWS_ENDPOINT_URL = var.use_localstack ? var.localstack_internal_endpoint : ""
  }
}

module "database" {
  source = "./modules/base/rds-module"

  project_name    = var.project_name
  env_suffix      = var.env_suffix
  use_localstack  = var.use_localstack
  password        = var.db_password
  create_instance = var.create_rds_instance
  fallback_host   = var.rds_fallback_host

  # Porta publicada pelo compose — como a máquina alcança o mesmo banco.
  host_accessible_host = var.rds_host_accessible_host
  host_accessible_port = var.rds_host_accessible_port
}

module "lambda" {
  source   = "./modules/base/lambda-module"
  for_each = local.services

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  service_name           = each.key
  lambda_package_file    = "${path.module}/../../apps/api/functions/${each.key}/dist/function.zip"
  runtime                = var.lambda_runtime
  memory_size            = var.lambda_memory_size
  timeout                = var.lambda_timeout
  reserved_concurrency   = var.reserved_concurrency
  logs_retention_in_days = var.logs_retention_in_days
  secret_arn             = module.database.secret_arn

  environment_variables = merge(local.common_environment, {
    SERVICE_NAME = each.key
  })
}

resource "aws_api_gateway_rest_api" "this" {
  name        = local.name
  description = "Saúde Bliss — gestão de solicitações (${var.env_suffix})"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# Recurso de versão (`/v1`): pai comum dos prefixos de domínio.
resource "aws_api_gateway_resource" "version" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = trimprefix(var.api_prefix, "/")
}

module "routing" {
  source   = "./modules/base/apigw-service"
  for_each = local.services

  rest_api_id          = aws_api_gateway_rest_api.this.id
  root_resource_id     = aws_api_gateway_resource.version.id
  route_prefix         = each.value.route_prefix
  lambda_invoke_arn    = module.lambda[each.key].invoke_arn
  lambda_function_name = module.lambda[each.key].function_name
  region               = var.region
  account_id           = data.aws_caller_identity.current.account_id
  use_localstack       = var.use_localstack
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # Hash do que compõe a API. O padrão da casa usa `timestamp()`, que força
  # redeploy em todo `apply` mesmo sem mudança — ruído no histórico e um
  # deployment novo a cada execução.
  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.version.id,
      [for key in keys(local.services) : module.routing[key].resource_ids],
      [for key in keys(local.services) : module.routing[key].integration_ids],
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [module.routing]
}

# Stage separado do deployment: o argumento `stage_name` embutido no
# `aws_api_gateway_deployment` está depreciado e não permite configurar log de
# acesso nem throttling.
resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.env_suffix

  # Log de acesso com `$context.requestId`: é o que permite provar que o id do
  # API Gateway e o das linhas de log da Lambda são o mesmo — a evidência de
  # rastreabilidade que o desafio pede.
  dynamic "access_log_settings" {
    for_each = var.use_localstack ? [] : [1]

    content {
      destination_arn = aws_cloudwatch_log_group.api_access[0].arn
      format = jsonencode({
        requestId          = "$context.requestId"
        ip                 = "$context.identity.sourceIp"
        requestTime        = "$context.requestTime"
        httpMethod         = "$context.httpMethod"
        resourcePath       = "$context.resourcePath"
        status             = "$context.status"
        responseLength     = "$context.responseLength"
        integrationLatency = "$context.integrationLatency"
      })
    }
  }
}

# O LocalStack não implementa log de acesso do API Gateway; criar o grupo lá só
# geraria recurso órfão.
resource "aws_cloudwatch_log_group" "api_access" {
  count = var.use_localstack ? 0 : 1

  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.logs_retention_in_days
}
