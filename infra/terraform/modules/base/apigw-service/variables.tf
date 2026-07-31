variable "rest_api_id" { type = string }
variable "root_resource_id" { type = string }

variable "route_prefix" {
  type        = string
  description = <<-EOT
    Prefixo do domínio sem barra, ex.: `requests`.

    É o que permite uma integração `{proxy+}` por microserviço. Se dois serviços
    dividissem o mesmo prefixo, seria preciso um método por rota aqui, e toda
    rota nova exigiria mexer na infraestrutura.
  EOT
}

variable "lambda_invoke_arn" { type = string }
variable "lambda_function_name" { type = string }
variable "region" { type = string }

variable "account_id" {
  type        = string
  description = "Conta AWS. O ARN de origem da permissão não aceita curinga aqui."
}
variable "use_localstack" { type = bool }
