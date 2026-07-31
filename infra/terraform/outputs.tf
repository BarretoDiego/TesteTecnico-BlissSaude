locals {
  # O `invoke_url` do provider aponta para `execute-api.amazonaws.com`, que não
  # existe no LocalStack. Lá o gateway expõe a API por um caminho próprio no
  # mesmo endpoint — daí a bifurcação, que é a única no arquivo inteiro.
  invoke_url = var.use_localstack ? "${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.this.id}/${aws_api_gateway_stage.this.stage_name}/_user_request_" : aws_api_gateway_stage.this.invoke_url
}

output "api_base_url" {
  description = "URL base da API. É a evidência de deploy do desafio."
  value       = "${local.invoke_url}${var.api_prefix}"
}

output "api_id" { value = aws_api_gateway_rest_api.this.id }

output "service_urls" {
  description = "URL de cada microserviço, sob o prefixo do seu domínio."
  value = {
    for key, service in local.services :
    key => "${local.invoke_url}${var.api_prefix}/${service.route_prefix}"
  }
}

output "lambda_functions" {
  value = { for key in keys(local.services) : key => module.lambda[key].function_name }
}

output "log_groups" {
  description = "Grupos de log para consulta no CloudWatch Logs Insights."
  value       = { for key in keys(local.services) : key => module.lambda[key].log_group_name }
}

output "database_secret_id" { value = module.database.secret_id }

output "database_url" {
  description = "Connection string para rodar migrations e seed a partir do host."
  value       = module.database.connection_string
  sensitive   = true
}
