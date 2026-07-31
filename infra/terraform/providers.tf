# =============================================================================
# Providers
#
# O mesmo HCL provisiona LocalStack e AWS real. A única diferença é a flag
# `use_localstack`: quando ligada, um bloco `endpoints` dinâmico redireciona
# todos os serviços para o gateway local e as validações de credencial são
# puladas.
#
# Deliberadamente sem `tflocal`: o wrapper exigiria uma dependência de Python no
# ambiente de quem for avaliar, e o bloco dinâmico entrega o mesmo resultado com
# `terraform` puro.
# =============================================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  # Credenciais fixas só no LocalStack, que aceita qualquer valor mas exige que
  # existam. Em AWS real ficam nulas e a cadeia padrão assume (variáveis de
  # ambiente, role da instância, perfil local).
  access_key = var.use_localstack ? "test" : null
  secret_key = var.use_localstack ? "test" : null

  # Todas as validações abaixo fazem chamadas ao IAM/STS reais que o LocalStack
  # não precisa atender. Mantê-las ligadas só adiciona latência e ruído de erro.
  s3_use_path_style           = var.use_localstack
  skip_credentials_validation = var.use_localstack
  skip_metadata_api_check     = var.use_localstack
  skip_requesting_account_id  = var.use_localstack

  dynamic "endpoints" {
    for_each = var.use_localstack ? [1] : []

    content {
      apigateway     = var.localstack_endpoint
      cloudwatch     = var.localstack_endpoint
      cloudwatchlogs = var.localstack_endpoint # não declarar `logs` junto: são o mesmo endpoint e o provider recusa ambos
      ec2            = var.localstack_endpoint
      events         = var.localstack_endpoint
      iam            = var.localstack_endpoint
      lambda         = var.localstack_endpoint
      rds            = var.localstack_endpoint
      s3             = var.localstack_endpoint
      secretsmanager = var.localstack_endpoint
      sqs            = var.localstack_endpoint
      sts            = var.localstack_endpoint
    }
  }

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.env_suffix
      ManagedBy   = "terraform"
    }
  }
}
