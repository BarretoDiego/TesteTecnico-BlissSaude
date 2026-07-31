variable "project_name" { type = string }
variable "env_suffix" { type = string }
variable "region" { type = string }
variable "use_localstack" { type = bool }
variable "rest_api_id" { type = string }

variable "package_dir" {
  type        = string
  description = "Diretório do microserviço, de onde sai dist/function.zip."
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "lambda_runtime" { type = string }
variable "logs_retention_in_days" { type = number }

variable "jwt_signing_key" {
  type      = string
  sensitive = true
}

variable "jwt_issuer" {
  type    = string
  default = "saude-bliss"
}

variable "jwt_audience" {
  type    = string
  default = "saude-bliss-api"
}

variable "result_ttl_in_seconds" {
  type        = number
  default     = 300
  description = <<-EOT
    Cache da política por token.

    É a razão de o authorizer existir como Lambda separada: com cache, a
    validação acontece uma vez por token e não uma vez por requisição. Zero
    desliga o cache e faz cada chamada invocar o authorizer — útil para depurar,
    caro em produção.

    O teto é o mesmo do token: uma política cacheada sobrevive à revogação até
    expirar, então TTL alto atrasa a revogação na mesma medida.
  EOT
}
