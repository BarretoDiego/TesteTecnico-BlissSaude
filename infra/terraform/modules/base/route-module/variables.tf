variable "rest_api_id" { type = string }

variable "domain_resource_id" {
  type        = string
  description = "Recurso do prefixo de domínio (ex.: /v1/requests). Raiz das rotas deste módulo."
}

variable "routes" {
  type = map(object({
    authorization = optional(string, "CUSTOM")
    authorizer_id = optional(string, "")
    api_key       = optional(bool, false)
  }))

  description = <<-EOT
    Rotas do microserviço, **uma entrada por método+caminho**.

    A chave é `"MÉTODO /caminho"`, com o caminho relativo ao prefixo do domínio:

        routes = {
          "POST /"        = {}                              # herda CUSTOM
          "GET /"         = {}
          "GET /{id}"     = {}
          "GET /health"   = { authorization = "NONE" }      # público
          "PATCH /{id}"   = { authorization = "CUSTOM" }
        }

    Declarar rota a rota — em vez de um `{proxy+}` que encaminha tudo — é o que
    permite autorização **por método**: `GET` autenticado e `POST` público no
    mesmo caminho, por exemplo. Também faz o API Gateway rejeitar caminho
    inexistente antes de invocar a Lambda, em vez de gastar invocação para
    devolver 404.

    O custo é a duplicação com o router da aplicação, que `pnpm check:routes`
    verifica.
  EOT
}

variable "lambda_invoke_arn" { type = string }
variable "lambda_function_name" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }

variable "default_authorizer_id" {
  type        = string
  default     = ""
  description = "Authorizer usado pelas rotas `CUSTOM` que não declaram um próprio."
}
