# =============================================================================
# Provisionamento dos microserviços.
#
# Terraform é a **única** coisa que cria ou muda recurso. O Serverless Framework
# é emulador local e packager — ver docs/adr/0002.
#
# Este arquivo cria só o que é **compartilhado**: a API, o recurso de versão, o
# banco e o stage. Lambda e rotas de cada microserviço ficam no módulo dele, em
# `modules/services/<serviço>/` — um domínio novo é um módulo novo e uma linha
# aqui, sem tocar em configuração alheia.
# =============================================================================

# Resolve a conta em uso. No LocalStack devolve a conta fictícia padrão; em AWS
# real, a da credencial — o mesmo HCL serve aos dois sem valor fixo.
data "aws_caller_identity" "current" {}

locals {
  name          = "${var.project_name}-${var.env_suffix}"
  functions_dir = "${path.module}/../../apps/api/functions"

  # Variáveis de ambiente comuns a todos os serviços. A credencial do banco
  # **não** está aqui: só o id do segredo, que a função resolve em runtime.
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

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # Hash do que compõe a API. O padrão da casa usa `timestamp()`, que força
  # redeploy em todo `apply` mesmo sem mudança — ruído no histórico e um
  # deployment novo a cada execução.
  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.version.id,
      module.bliss_requests.resource_ids,
      module.bliss_requests.integration_ids,
      module.bliss_reviews.resource_ids,
      module.bliss_reviews.integration_ids,
      module.bliss_auth.resource_ids,
      module.bliss_auth.integration_ids,
      # O authorizer entra no hash: trocá-lo muda a autorização dos métodos e
      # exige redeploy do stage para valer.
      var.enable_authorizer ? module.bliss_authorizer.authorizer_id : "sem-authorizer",
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [module.bliss_requests, module.bliss_reviews, module.bliss_auth]
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

# -----------------------------------------------------------------------------
# Microserviços
#
# O authorizer vem primeiro: os módulos de domínio recebem o id dele e aplicam
# `authorization = CUSTOM` aos próprios métodos.
# -----------------------------------------------------------------------------

module "bliss_authorizer" {
  source = "./modules/services/bliss-authorizer"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  region                 = var.region
  use_localstack         = var.use_localstack
  rest_api_id            = aws_api_gateway_rest_api.this.id
  package_dir            = "${local.functions_dir}/bliss-authorizer"
  lambda_runtime         = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days
  environment_variables  = local.common_environment
  jwt_signing_key        = var.jwt_signing_key
  result_ttl_in_seconds  = var.authorizer_cache_ttl
}

module "bliss_auth" {
  source = "./modules/services/bliss-auth"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  region                 = var.region
  account_id             = data.aws_caller_identity.current.account_id
  use_localstack         = var.use_localstack
  rest_api_id            = aws_api_gateway_rest_api.this.id
  root_resource_id       = aws_api_gateway_resource.version.id
  authorizer_id          = var.enable_authorizer ? module.bliss_authorizer.authorizer_id : ""
  package_dir            = "${local.functions_dir}/bliss-auth"
  lambda_runtime         = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days
  environment_variables  = local.common_environment
  secret_arn             = module.database.secret_arn
  jwt_secret_id          = module.bliss_authorizer.jwt_secret_id
  jwt_secret_arn         = module.bliss_authorizer.jwt_secret_arn
}

module "bliss_requests" {
  source = "./modules/services/bliss-requests"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  region                 = var.region
  account_id             = data.aws_caller_identity.current.account_id
  use_localstack         = var.use_localstack
  rest_api_id            = aws_api_gateway_rest_api.this.id
  root_resource_id       = aws_api_gateway_resource.version.id
  authorizer_id          = var.enable_authorizer ? module.bliss_authorizer.authorizer_id : ""
  package_dir            = "${local.functions_dir}/bliss-requests"
  lambda_runtime         = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days
  environment_variables  = local.common_environment
  secret_arn             = module.database.secret_arn
}

module "bliss_reviews" {
  source = "./modules/services/bliss-reviews"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  region                 = var.region
  account_id             = data.aws_caller_identity.current.account_id
  use_localstack         = var.use_localstack
  rest_api_id            = aws_api_gateway_rest_api.this.id
  root_resource_id       = aws_api_gateway_resource.version.id
  authorizer_id          = var.enable_authorizer ? module.bliss_authorizer.authorizer_id : ""
  package_dir            = "${local.functions_dir}/bliss-reviews"
  lambda_runtime         = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days
  environment_variables  = local.common_environment
  secret_arn             = module.database.secret_arn
}
