output "secret_id" { value = aws_secretsmanager_secret.database.id }
output "secret_arn" { value = aws_secretsmanager_secret.database.arn }
output "host" { value = local.host }
output "port" { value = local.port }
output "db_name" { value = var.db_name }

output "connection_string" {
  description = "Connection string a partir do **host** — para migrations, seed e inspeção."
  value       = "postgresql://${var.username}:${var.password}@${local.external_host}:${local.external_port}/${var.db_name}"
  sensitive   = true
}

output "lambda_connection_string" {
  description = "Connection string a partir da **Lambda** — é a que vai para o segredo."
  value       = "postgresql://${var.username}:${var.password}@${local.host}:${local.port}/${var.db_name}"
  sensitive   = true
}
