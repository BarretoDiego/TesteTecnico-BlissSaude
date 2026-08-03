#!/usr/bin/env bash
# =============================================================================
# Valida o authorizer invocando a Lambda diretamente.
#
# Existe porque o API Gateway do LocalStack Community não executa custom
# authorizers. A configuração está correta — `get-method` devolve
# `authorizationType: CUSTOM` com o `authorizerId` do authorizer criado — mas a
# emulação não chega a invocá-lo.
#
# Invocar direto exercita exatamente o mesmo contrato que o API Gateway usaria:
# evento `REQUEST` na entrada, documento de política na saída. É a evidência
# possível neste ambiente, e a mesma Lambda sobe inalterada na AWS real.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"

pass() { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
fail() {
	printf '  \033[0;31m✗\033[0m %s\n' "$*" >&2
	exit 1
}

# Alvo parametrizável: as duas trilhas de deploy nomeiam a função de formas
# diferentes. Sem override, resolve pelos outputs do Terraform — o caminho
# padrão, inalterado. A trilha do Serverless Framework passa os valores dela.
FN="${AUTHORIZER_FUNCTION:-$(terraform -chdir="$TF_DIR" output -json lambda_functions |
	python3 -c 'import sys,json;print(json.load(sys.stdin)["bliss-authorizer"])')}"
API="${API_ID:-$(terraform -chdir="$TF_DIR" output -raw api_id)}"
ARN="arn:aws:execute-api:us-east-1:000000000000:${API}/${API_STAGE:-local}/GET/v1/requests"

invoke() { # <header Authorization> → efeito da política
	local payload
	payload=$(printf '{"type":"REQUEST","methodArn":"%s","headers":{"authorization":"%s"},"requestContext":{"path":"/v1/requests","httpMethod":"GET"}}' "$ARN" "$1")
	printf '%s' "$payload" >/tmp/bliss-authz-event.json

	"$ROOT_DIR/scripts/localstack/aws.sh" lambda invoke \
		--function-name "$FN" --payload fileb:///tmp/bliss-authz-event.json \
		/tmp/bliss-authz-out.json >/dev/null

	python3 -c 'import json;print(json.load(open("/tmp/bliss-authz-out.json"))["policyDocument"]["Statement"][0]["Effect"])'
}

TOKEN="$(pnpm --silent --filter @saude-bliss/bliss-authorizer token 2>/dev/null | tail -1)"
[ -n "$TOKEN" ] || fail "não foi possível emitir um token"

[ "$(invoke "Bearer $TOKEN")" = "Allow" ] && pass "authorizer: token válido → Allow" || fail "token válido deveria produzir Allow"
[ "$(invoke "Bearer forjado")" = "Deny" ] && pass "authorizer: token forjado → Deny" || fail "token forjado deveria produzir Deny"
[ "$(invoke "")" = "Deny" ] && pass "authorizer: sem credencial → Deny" || fail "ausência de credencial deveria produzir Deny"
