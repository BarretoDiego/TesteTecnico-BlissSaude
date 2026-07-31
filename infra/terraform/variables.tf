variable "project_name" {
  type    = string
  default = "saude-bliss"
}

variable "env_suffix" {
  type        = string
  description = "local | dev | stage | prod"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "use_localstack" {
  type        = bool
  default     = false
  description = "Única flag que separa o alvo local do alvo AWS real. O HCL é o mesmo."
}

variable "localstack_endpoint" {
  type        = string
  default     = "http://localhost:4568"
  description = "Endereço do LocalStack a partir do **host** — usado pelo Terraform e pelo curl."
}

variable "localstack_internal_endpoint" {
  type        = string
  default     = "http://saude-bliss-localstack:4566"
  description = <<-EOT
    Endereço do LocalStack a partir de **dentro** da rede docker.

    A Lambda roda no próprio container, então `localhost` ali é ela mesma, não o
    LocalStack. Passar o endpoint externo faz toda chamada de SDK dentro da
    função falhar por conexão recusada — inclusive a leitura do segredo do banco,
    que aparece como 503 no health sem indicar a causa.

    É a mesma dualidade do banco: um endereço para quem está na rede docker,
    outro para quem está no host.
  EOT
}

variable "api_prefix" {
  type        = string
  default     = "/v1"
  description = "Prefixo de versão. Compõe com o prefixo de domínio de cada serviço."
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "lambda_memory_size" {
  type    = number
  default = 512
}

variable "lambda_timeout" {
  type    = number
  default = 29
}

variable "reserved_concurrency" {
  type        = number
  default     = 10
  description = "Ver a aritmética de pool em packages/database/src/client.ts."
}

variable "db_pool_max" {
  type    = number
  default = 1
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "logs_retention_in_days" {
  type    = number
  default = 7
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "saudebliss"
}

variable "create_rds_instance" {
  type        = bool
  default     = true
  description = "Escape hatch do RDS emulado — ver modules/base/rds-module/variables.tf."
}

variable "rds_fallback_host" {
  type        = string
  default     = "postgres"
  description = "Host do Postgres do compose, quando create_rds_instance = false."
}

variable "rds_host_accessible_host" {
  type        = string
  default     = "localhost"
  description = "Endereço do banco a partir do host, para migrations e seed."
}

variable "rds_host_accessible_port" {
  type    = number
  default = 5433
}

# -----------------------------------------------------------------------------
# Autorização
# -----------------------------------------------------------------------------

variable "enable_authorizer" {
  type        = bool
  default     = true
  description = <<-EOT
    Aplica o authorizer às rotas de domínio.

    Com `false` a API fica aberta — útil para isolar um problema de aplicação sem
    o authorizer no caminho. As rotas `/health` continuam públicas nos dois casos.
  EOT
}

variable "jwt_signing_key" {
  type      = string
  sensitive = true
  default   = "chave-de-desenvolvimento-trocar-em-producao"

  validation {
    # HS256 com chave curta é quebrável por força bruta. 32 bytes é o mínimo
    # recomendado para o tamanho do digest.
    condition     = length(var.jwt_signing_key) >= 32
    error_message = "A chave de assinatura deve ter ao menos 32 caracteres."
  }
}

variable "authorizer_cache_ttl" {
  type        = number
  default     = 300
  description = "Segundos de cache da política por token. Ver o módulo do authorizer."
}
