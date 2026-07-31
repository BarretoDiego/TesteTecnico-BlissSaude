variable "project_name" { type = string }
variable "env_suffix" { type = string }

variable "service_name" {
  type        = string
  description = "Nome do microserviço, ex.: bliss-requests. Vira o nome da função e do log group."
}

variable "lambda_package_file" {
  type        = string
  description = "Caminho do zip produzido por build.js. Terraform e serverless consomem o mesmo arquivo."
}

variable "handler" {
  type    = string
  default = "app.lambdaHandler"
}

variable "runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "timeout" {
  type        = number
  default     = 29
  description = "Teto do API Gateway REST. Adiantar o corte evita devolver 504 opaco."
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "reserved_concurrency" {
  type        = number
  default     = 10
  description = <<-EOT
    Teto duro de invocações simultâneas — e, por consequência, de conexões no
    banco. A aritmética que precisa valer:

        max_connections >= reserved_concurrency * DB_POOL_MAX + folga

    Sem esse teto, um pico de tráfego abre mais conexões do que a instância
    aceita e o banco recusa **todas**, não só o excedente.
  EOT
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "logs_retention_in_days" {
  type    = number
  default = 7
}

variable "secret_arn" {
  type        = string
  default     = ""
  description = "ARN do segredo que a função pode ler. Vazio libera nenhum."
}
