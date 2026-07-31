variable "project_name" { type = string }
variable "env_suffix" { type = string }
variable "use_localstack" { type = bool }

variable "engine_version" {
  type    = string
  default = "16.3"
}

variable "instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "Menor classe do free tier. Aceita ~87 conexões — ver a aritmética de pool."
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "saudebliss"
}

variable "username" {
  type    = string
  default = "saudebliss"
}

variable "password" {
  type      = string
  sensitive = true
}

variable "fallback_host" {
  type        = string
  default     = "postgres"
  description = <<-EOT
    Host usado quando `create_instance = false`: o Postgres do docker-compose,
    alcançável pelo nome do serviço a partir do container da Lambda.
  EOT
}

variable "fallback_port" {
  type    = number
  default = 5432
}

variable "host_accessible_host" {
  type        = string
  default     = "localhost"
  description = <<-EOT
    Endereço do banco **a partir do host**.

    Com o Postgres do compose há dois endereços para o mesmo banco: a Lambda roda
    dentro da rede docker e o alcança por `postgres:5432`; migrations e seed rodam
    na máquina e precisam de `localhost:5433`. Guardar só um dos dois faz um dos
    lados falhar com "ENOTFOUND" ou "connection refused".
  EOT
}

variable "host_accessible_port" {
  type    = number
  default = 5433
}

variable "create_instance" {
  type        = bool
  default     = true
  description = <<-EOT
    Escape hatch. A emulação de RDS do LocalStack é um Postgres comum por trás —
    parameter group, multi-AZ, réplica, backup e Performance Insights são no-op
    ou erro, e a criação leva 30–60s depois que o Terraform já retornou.

    Com `false`, o módulo não cria instância e aponta o segredo para o Postgres
    do compose. Transforma um beco sem saída em pivô de 30 segundos.
  EOT
}
