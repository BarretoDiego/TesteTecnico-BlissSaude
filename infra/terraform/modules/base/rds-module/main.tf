# =============================================================================
# Banco de dados e a credencial que a Lambda lê.
#
# A senha nunca vai para variável de ambiente da função: variável de ambiente
# aparece no console e em qualquer `GetFunctionConfiguration`. A Lambda recebe só
# o id do segredo e busca o valor em runtime.
# =============================================================================

locals {
  name = "${var.project_name}-${var.env_suffix}"

  # Endereço que a **Lambda** usa: dentro da rede docker, ou o endpoint do RDS.
  host = var.create_instance ? aws_db_instance.this[0].address : var.fallback_host
  port = var.create_instance ? aws_db_instance.this[0].port : var.fallback_port

  # Endereço que o **host** usa para migrations e seed. Com o RDS emulado é o
  # mesmo; com o Postgres do compose, muda de `postgres:5432` para
  # `localhost:5433` — a porta publicada pelo compose.
  external_host = var.create_instance ? local.host : var.host_accessible_host
  external_port = var.create_instance ? local.port : var.host_accessible_port
}

resource "aws_db_instance" "this" {
  count = var.create_instance ? 1 : 0

  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage = var.allocated_storage
  db_name           = var.db_name
  username          = var.username
  password          = var.password

  # Take-home: a instância é criada, evidenciada e destruída. Proteção de exclusão
  # e snapshot final só atrapalhariam o `terraform destroy`.
  skip_final_snapshot = true
  deletion_protection = false

  publicly_accessible = var.use_localstack

  # Backup e janela de manutenção são no-op no LocalStack e custam em AWS real
  # para um ambiente efêmero. Em produção isto seria o oposto.
  backup_retention_period = var.use_localstack ? 0 : 7

  lifecycle {
    # O LocalStack devolve alguns atributos normalizados de forma diferente da
    # AWS, e sem isto todo `plan` subsequente acusa mudança que não existe.
    ignore_changes = [engine_version, availability_zone, backup_window, maintenance_window]
  }
}

resource "aws_secretsmanager_secret" "database" {
  name = "/${var.env_suffix}/${var.project_name}/database/credentials"

  # Segredo excluído fica em quarentena por padrão (7 dias), o que impede
  # recriar com o mesmo nome — inviável para um ciclo de subir e destruir.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id

  # O formato aqui é o que `SecretsService.getDatabaseUrl` espera desserializar.
  secret_string = jsonencode({
    username = var.username
    password = var.password
    host     = local.host
    port     = local.port
    dbname   = var.db_name
  })
}
