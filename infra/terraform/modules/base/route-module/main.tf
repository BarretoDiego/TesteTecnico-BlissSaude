# =============================================================================
# Rotas de um microserviço no API Gateway.
#
# Recebe um mapa `"MÉTODO /caminho"` e cria recurso, método e integração para
# cada entrada. Deriva a árvore de recursos do próprio caminho, de modo que
# adicionar uma rota é acrescentar **uma linha** ao mapa — sem encadear
# `parent_id` entre blocos `module`, que é onde a configuração manual erra.
#
# Profundidade máxima: dois segmentos abaixo do domínio (`/{id}/timeline`).
# Terraform não permite que um recurso referencie a si mesmo em `for_each`, então
# a árvore é montada em níveis explícitos. Um terceiro nível seria mais um bloco
# no mesmo formato — a restrição é deliberada e visível, não uma surpresa.
# =============================================================================

locals {
  # "GET /{id}/timeline" → { method = "GET", segments = ["{id}", "timeline"] }
  parsed = {
    for key, config in var.routes : key => {
      method   = split(" ", key)[0]
      segments = compact(split("/", trimprefix(split(" ", key)[1], "/")))
      config   = config
    }
  }

  # Segmentos distintos por nível — vários métodos compartilham um recurso.
  level1 = toset([for route in local.parsed : route.segments[0] if length(route.segments) >= 1])

  level2 = {
    for route in local.parsed :
    "${route.segments[0]}/${route.segments[1]}" => {
      parent = route.segments[0]
      part   = route.segments[1]
    }
    if length(route.segments) >= 2
  }

  # Resolve o recurso de cada rota: raiz do domínio, nível 1 ou nível 2.
  resource_id_for = {
    for key, route in local.parsed : key => (
      length(route.segments) == 0 ? var.domain_resource_id :
      length(route.segments) == 1 ? aws_api_gateway_resource.level1[route.segments[0]].id :
      aws_api_gateway_resource.level2["${route.segments[0]}/${route.segments[1]}"].id
    )
  }
}

resource "aws_api_gateway_resource" "level1" {
  for_each = local.level1

  rest_api_id = var.rest_api_id
  parent_id   = var.domain_resource_id
  path_part   = each.value
}

resource "aws_api_gateway_resource" "level2" {
  for_each = local.level2

  rest_api_id = var.rest_api_id
  parent_id   = aws_api_gateway_resource.level1[each.value.parent].id
  path_part   = each.value.part
}

resource "aws_api_gateway_method" "this" {
  for_each = local.parsed

  rest_api_id      = var.rest_api_id
  resource_id      = local.resource_id_for[each.key]
  http_method      = each.value.method
  authorization    = each.value.config.authorization
  api_key_required = each.value.config.api_key

  # `authorizer_id` só faz sentido em `CUSTOM`; passá-lo em `NONE` é erro de plano.
  authorizer_id = each.value.config.authorization == "CUSTOM" ? (
    each.value.config.authorizer_id != "" ? each.value.config.authorizer_id : var.default_authorizer_id
  ) : null

  # Parâmetro de caminho declarado ao gateway. Sem isso ele aceita a rota mas não
  # repassa o valor, e a aplicação recebe o path sem o segmento.
  request_parameters = {
    for segment in each.value.segments :
    "method.request.path.${trim(segment, "{}")}" => true
    if startswith(segment, "{")
  }
}

resource "aws_api_gateway_integration" "this" {
  for_each = aws_api_gateway_method.this

  rest_api_id = var.rest_api_id
  resource_id = each.value.resource_id
  http_method = each.value.http_method

  type = "AWS_PROXY"
  # Sempre `POST`: é a chamada que o API Gateway faz para a Lambda, e não tem
  # relação com o método da requisição. Confundir os dois dá 500 sem mensagem.
  integration_http_method = "POST"
  uri                     = var.lambda_invoke_arn
}

# Uma permissão por função, no nível da API — não uma por rota.
#
# O módulo da casa calcula um prefixo de caminho por rota, o que gera N permissões
# e um `statement_id` por rota que colide quando duas rotas compartilham prefixo.
# Autorizar a API inteira é equivalente na prática (todas as rotas apontam para
# esta função) e elimina a classe de erro.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "arn:aws:execute-api:${var.region}:${var.account_id}:${var.rest_api_id}/*/*"
}

# CORS não é declarado aqui de propósito: sob `AWS_PROXY` o API Gateway repassa a
# requisição inteira e os `method_response`/`integration_response` com headers
# fixos — que o módulo da casa cria — são ignorados. Quem responde CORS, inclusive
# o preflight `OPTIONS`, é o `@fastify/cors` dentro da aplicação.
