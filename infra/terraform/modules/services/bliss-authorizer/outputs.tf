output "authorizer_id" { value = aws_api_gateway_authorizer.this.id }
output "function_name" { value = module.lambda.function_name }
output "log_group_name" { value = module.lambda.log_group_name }
output "jwt_secret_id" { value = aws_secretsmanager_secret.jwt.id }
