variable "project_name" { type = string }
variable "env_suffix" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "use_localstack" { type = bool }

variable "rest_api_id" { type = string }
variable "root_resource_id" {
  type        = string
  description = "Recurso do prefixo de versão (/v1) — pai do prefixo de domínio."
}

variable "authorizer_id" {
  type        = string
  default     = ""
  description = "Id do authorizer. Vazio deixa as rotas do serviço públicas."
}

variable "package_dir" {
  type        = string
  description = "Diretório do microserviço, de onde sai dist/function.zip."
}

variable "environment_variables" {
  type        = map(string)
  default     = {}
  description = "Variáveis comuns da plataforma. O módulo acrescenta as suas."
}

variable "secret_arn" { type = string }
variable "lambda_runtime" { type = string }
variable "logs_retention_in_days" { type = number }

