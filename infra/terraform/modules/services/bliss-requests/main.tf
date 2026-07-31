# =============================================================================
# bliss-requests — configuração completa do microserviço.
#
# Lambda e rotas do API Gateway declaradas juntas, no arquivo do próprio serviço.
# É o que permite adicionar um domínio novo sem tocar na raiz do Terraform: cria-se
# o módulo e uma linha em `main.tf` o instancia.
#
# O `route_prefix` daqui casa com o `ROUTE_PREFIX` do router — `pnpm check:routes`
# verifica a paridade.
# =============================================================================

locals {
  service_name = "bliss-requests"
  route_prefix = "requests"
}

module "lambda" {
  source = "../../base/lambda-module"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  service_name           = local.service_name
  lambda_package_file    = "${var.package_dir}/dist/function.zip"
  runtime                = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days
  secret_arn             = var.secret_arn

  # Perfil deste domínio: fluxo contínuo de abertura e consulta, payload pequeno.
  memory_size          = 512
  timeout              = 29
  reserved_concurrency = 10

  environment_variables = merge(var.environment_variables, {
    SERVICE_NAME = local.service_name
  })
}

# Prefixo do domínio (`/v1/requests`), pai de todas as rotas do serviço.
resource "aws_api_gateway_resource" "domain" {
  rest_api_id = var.rest_api_id
  parent_id   = var.root_resource_id
  path_part   = local.route_prefix
}

# -----------------------------------------------------------------------------
# Rotas
#
# Uma entrada por método+caminho. Adicionar uma rota é acrescentar uma linha aqui
# **e** no router da aplicação — `pnpm check:routes` compara os dois.
# -----------------------------------------------------------------------------

module "routing" {
  source = "../../base/route-module"

  rest_api_id           = var.rest_api_id
  domain_resource_id    = aws_api_gateway_resource.domain.id
  lambda_invoke_arn     = module.lambda.invoke_arn
  lambda_function_name  = module.lambda.function_name
  region                = var.region
  account_id            = var.account_id
  default_authorizer_id = var.authorizer_id

  routes = {
    # Abertura e consulta — exigem token.
    "POST /"    = {}
    "GET /"     = {}
    "GET /{id}" = {}

    # Health fora da autenticação: monitoração não deve precisar de credencial.
    "GET /health" = { authorization = "NONE" }
  }
}
