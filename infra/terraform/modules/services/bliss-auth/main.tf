# =============================================================================
# bliss-auth — configuração completa do microserviço.
#
# Autenticação: emite o par de tokens que o `bliss-authorizer` valida na borda.
# =============================================================================

locals {
  service_name = "bliss-auth"
  route_prefix = "auth"
}

module "lambda" {
  source = "../../base/lambda-module"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  service_name           = local.service_name
  lambda_package_file    = "${var.package_dir}/dist/function.zip"
  runtime                = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days

  # Precisa ler dois segredos: a credencial do banco e a chave de assinatura.
  # O módulo base aceita um; o segundo entra pela política adicional abaixo.
  secret_arn = var.secret_arn

  # Mais memória que os serviços de leitura: a derivação da senha é memory-hard
  # de propósito (scrypt com N=2^15 usa ~33MB) e, em Lambda, CPU escala junto com
  # memória — subdimensionar aqui torna o login lento sem torná-lo mais barato.
  memory_size = 1024
  timeout     = 15

  # Concorrência baixa: login é evento por sessão, não por requisição. Um teto
  # apertado aqui também limita quanto uma tentativa de força bruta distribuída
  # consegue consumir de CPU e de conexões do banco.
  reserved_concurrency = 5

  environment_variables = merge(var.environment_variables, {
    SERVICE_NAME  = local.service_name
    JWT_SECRET_ID = var.jwt_secret_id
  })
}

# Leitura da chave de assinatura, além da credencial do banco que o módulo base
# já concede.
resource "aws_iam_role_policy" "jwt_secret" {
  name = "${var.project_name}-${local.service_name}-${var.env_suffix}-jwt"
  role = split("/", module.lambda.role_arn)[1]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      Resource = var.jwt_secret_arn
    }]
  })
}

# Prefixo do domínio (`/v1/auth`), pai de todas as rotas do serviço.
resource "aws_api_gateway_resource" "domain" {
  rest_api_id = var.rest_api_id
  parent_id   = var.root_resource_id
  path_part   = local.route_prefix
}

# -----------------------------------------------------------------------------
# Rotas
#
# `login`, `refresh` e `logout` são **públicas** por definição: quem as chama
# ainda não tem token, e exigir um seria impossível de satisfazer. `me` é a única
# autenticada — é ela que traduz o token em identidade para o backoffice.
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
    "POST /login"   = { authorization = "NONE" }
    "POST /refresh" = { authorization = "NONE" }
    "POST /logout"  = { authorization = "NONE" }

    "GET /me" = {}

    "GET /health" = { authorization = "NONE" }
  }
}
