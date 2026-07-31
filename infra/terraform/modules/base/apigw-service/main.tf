# =============================================================================
# Roteamento do API Gateway para um microserviço.
#
# Dois recursos por serviço: o caminho raiz do domínio (`/requests`) e a rota
# greedy (`/requests/{proxy+}`). Ambos com `ANY` e integração `AWS_PROXY`, que
# entrega o evento inteiro ao Fastify — o roteamento fino acontece na aplicação,
# onde já está declarado, e não duplicado aqui.
# =============================================================================

# /requests
resource "aws_api_gateway_resource" "domain" {
  rest_api_id = var.rest_api_id
  parent_id   = var.root_resource_id
  path_part   = var.route_prefix
}

# /requests/{proxy+}
resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = var.rest_api_id
  parent_id   = aws_api_gateway_resource.domain.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "domain" {
  rest_api_id   = var.rest_api_id
  resource_id   = aws_api_gateway_resource.domain.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id   = var.rest_api_id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "ANY"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

# `AWS_PROXY` sempre com `POST` como `integration_http_method`: é a chamada que o
# API Gateway faz para a Lambda, e não tem relação com o método da requisição.
# Confundir os dois é um erro clássico que resulta em 500 sem mensagem.
resource "aws_api_gateway_integration" "domain" {
  rest_api_id             = var.rest_api_id
  resource_id             = aws_api_gateway_resource.domain.id
  http_method             = aws_api_gateway_method.domain.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = var.lambda_invoke_arn
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id             = var.rest_api_id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.proxy.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = var.lambda_invoke_arn
}

# Sem esta permissão o API Gateway recebe 403 da Lambda e devolve 500 ao cliente
# — sintoma que não indica a causa em lugar nenhum.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke-${var.route_prefix}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"

  # `/*/*` cobre qualquer stage e qualquer método sob esta API. A conta precisa
  # ser explícita: o campo não aceita curinga, e usar `*` faz o provider recusar
  # o ARN antes mesmo de chamar a AWS.
  source_arn = "arn:aws:execute-api:${var.region}:${var.account_id}:${var.rest_api_id}/*/*"
}

# CORS não é configurado aqui de propósito: sob `AWS_PROXY` o API Gateway
# repassa a requisição inteira e os `method_response`/`integration_response`
# com headers fixos são ignorados. Quem responde CORS — inclusive o preflight
# OPTIONS — é o `@fastify/cors` dentro da aplicação.
