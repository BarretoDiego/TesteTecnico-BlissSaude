# =============================================================================
# bliss-authorizer — configuração completa do microserviço.
#
# Diferente dos serviços de domínio, este não declara rota: não atende caminho
# nenhum. O que ele cria é o `aws_api_gateway_authorizer`, que os demais módulos
# recebem por id e aplicam aos próprios métodos.
#
# Mesma estrutura dos outros — Lambda e configuração do API Gateway juntas, no
# arquivo do próprio serviço.
# =============================================================================

locals {
  service_name = "bliss-authorizer"
}

# A chave de assinatura segue o mesmo princípio da credencial do banco: vai para
# o Secrets Manager, não para variável de ambiente da função — variável de
# ambiente aparece no console e em qualquer `GetFunctionConfiguration`.
resource "aws_secretsmanager_secret" "jwt" {
  name                    = "/${var.env_suffix}/${var.project_name}/auth/jwt"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({ signingKey = var.jwt_signing_key })
}

module "lambda" {
  source = "../../base/lambda-module"

  project_name           = var.project_name
  env_suffix             = var.env_suffix
  service_name           = local.service_name
  lambda_package_file    = "${var.package_dir}/dist/function.zip"
  runtime                = var.lambda_runtime
  logs_retention_in_days = var.logs_retention_in_days
  secret_arn             = aws_secretsmanager_secret.jwt.arn

  # Não toca banco nem rede além do Secrets Manager: só valida assinatura. Uma
  # função enxuta aqui importa mais que nos demais — ela entra no caminho de
  # toda requisição autenticada, e seu cold start é latência de todo mundo.
  memory_size = 256
  timeout     = 10

  # Sem concorrência reservada: o authorizer não abre conexão de banco, então o
  # teto que protege o Postgres não se aplica. Limitá-lo transformaria o
  # authorizer no gargalo da API inteira.
  reserved_concurrency = -1

  environment_variables = merge(var.environment_variables, {
    SERVICE_NAME  = local.service_name
    JWT_SECRET_ID = aws_secretsmanager_secret.jwt.id
    JWT_ISSUER    = var.jwt_issuer
    JWT_AUDIENCE  = var.jwt_audience
  })
}

# Permissão para o API Gateway invocar o authorizer. Sem ela o gateway recebe
# 403 da Lambda e devolve 500 ao cliente, sem indicar a causa em lugar nenhum.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda.function_name
  principal     = "apigateway.amazonaws.com"
}

resource "aws_api_gateway_authorizer" "this" {
  name        = "${var.project_name}-${local.service_name}-${var.env_suffix}"
  rest_api_id = var.rest_api_id

  # `REQUEST` e não `TOKEN`: o authorizer enxerga headers, caminho e método, o
  # que permite decidir por rota no futuro sem trocar o tipo — trocar o tipo
  # depois exige recriar todos os métodos que o referenciam.
  type                   = "REQUEST"
  authorizer_uri         = module.lambda.invoke_arn
  authorizer_credentials = aws_iam_role.invocation.arn

  # A chave do cache. Com `identity_source` vazio o API Gateway desabilita o
  # cache silenciosamente, e o authorizer passa a ser invocado a cada requisição.
  identity_source                  = "method.request.header.Authorization"
  authorizer_result_ttl_in_seconds = var.result_ttl_in_seconds
}

# O API Gateway assume este papel para invocar o authorizer. É separado da
# `aws_lambda_permission` de propósito: um authorizer do tipo REQUEST exige
# credencial explícita, não apenas permissão baseada em recurso.
resource "aws_iam_role" "invocation" {
  name = "${var.project_name}-${local.service_name}-${var.env_suffix}-invocation"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "invocation" {
  name = "${var.project_name}-${local.service_name}-${var.env_suffix}-invocation"
  role = aws_iam_role.invocation.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = module.lambda.function_arn
    }]
  })
}
