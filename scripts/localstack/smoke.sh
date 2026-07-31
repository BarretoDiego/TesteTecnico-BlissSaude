#!/usr/bin/env bash
# =============================================================================
# Smoke test contra a API implantada.
#
# Exercita exatamente os endpoints que o desafio especifica, mais a conferência,
# e confere o requestId ponta a ponta. É a evidência de deploy funcional.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${API_BASE_URL:-$(terraform -chdir="$ROOT_DIR/infra/terraform" output -raw api_base_url)}"

pass() { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
fail() {
	printf '  \033[0;31m✗\033[0m %s\n' "$*" >&2
	exit 1
}

check() { # <esperado> <obtido> <descrição>
	[ "$1" = "$2" ] && pass "$3 → $2" || fail "$3 → esperado $1, obtido $2"
}

echo "smoke test em $BASE"

# --- rotas públicas --------------------------------------------------------
# `/health` fica fora do authorizer de propósito: monitoração não deve precisar
# de credencial, e este smoke é a prova de que continua assim.
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests/health")" "GET  /requests/health (público)"
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/reviews/health")" "GET  /reviews/health (público)"

# --- autorização -----------------------------------------------------------
#
# O authorizer é declarado no Terraform e aplicado aos métodos, mas o **API
# Gateway do LocalStack Community não executa custom authorizers** — a requisição
# passa direto. Não é defeito da configuração: `aws apigateway get-method` mostra
# `authorizationType: CUSTOM` com o `authorizerId` correto.
#
# Em vez de fingir que passou ou falhar por uma limitação de ambiente, o smoke
# detecta qual dos dois cenários está em vigor e valida o authorizer do jeito que
# der: pela borda quando ela aplica, e por invocação direta quando não.
AUTH=()
if [ "${SKIP_AUTH:-0}" != "1" ]; then
	TOKEN="$(pnpm --silent --filter @saude-bliss/bliss-authorizer token 2>/dev/null | tail -1)"
	[ -n "$TOKEN" ] || fail "não foi possível emitir um token"
	AUTH=(-H "Authorization: Bearer $TOKEN")

	SEM_TOKEN="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests")"

	if [ "$SEM_TOKEN" = "401" ] || [ "$SEM_TOKEN" = "403" ]; then
		pass "GET  /requests sem token → $SEM_TOKEN (authorizer aplicado na borda)"
		check 403 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer forjado' "$BASE/requests")" "GET  /requests com token forjado"
		check 200 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/requests")" "GET  /requests com token válido"
	else
		printf '  \033[0;33m!\033[0m authorizer não aplicado pela borda (LocalStack Community) — validando por invocação direta\n'
		"$ROOT_DIR/scripts/localstack/verify-authorizer.sh"
	fi
fi

# --- criação ---------------------------------------------------------------
TRACE="smoke-$(date +%s)"
BODY=$(curl -s -X POST "$BASE/requests" "${AUTH[@]}" \
	-H 'Content-Type: application/json' -H "x-request-id: $TRACE" \
	-d '{"title":"Smoke test de deploy","description":"Solicitação criada pelo smoke test para validar o deploy.","priority":"high","createdBy":"smoke@saudebliss.test"}')
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/requests" "${AUTH[@]}" \
	-H 'Content-Type: application/json' \
	-d '{"title":"Smoke test de deploy","description":"Solicitação criada pelo smoke test para validar o deploy.","priority":"low","createdBy":"smoke@saudebliss.test"}')
check 201 "$STATUS" "POST /requests"

ID=$(printf '%s' "$BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')

# O requestId enviado precisa voltar no envelope e estar persistido na linha.
RETURNED=$(printf '%s' "$BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["requestId"])')
PERSISTED=$(printf '%s' "$BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["createdTraceId"])')
check "$TRACE" "$RETURNED" "requestId no envelope"
check "$TRACE" "$PERSISTED" "requestId persistido em createdTraceId"

# --- consulta e filtros ----------------------------------------------------
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/requests/$ID")" "GET  /requests/{id}"
check 404 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/requests/00000000-0000-4000-8000-999999999999")" "GET  /requests/{id} inexistente"
check 400 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/requests/nao-e-uuid")" "GET  /requests/{id} malformado"
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/requests?status=open")" "GET  /requests?status="
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/requests?createdBy=smoke@saudebliss.test")" "GET  /requests?createdBy="
check 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/requests" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"title":"ab"}')" "POST /requests inválido"

# --- conferência (outro microserviço) --------------------------------------
check 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/reviews/$ID" "${AUTH[@]}" \
	-H 'Content-Type: application/json' -d '{"reviewedBy":"smoke@saudebliss.test","status":"reviewed"}')" "PATCH /reviews/{id}"
check 409 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/reviews/$ID" "${AUTH[@]}" \
	-H 'Content-Type: application/json' -d '{"reviewedBy":"outro@saudebliss.test","status":"reviewed"}')" "PATCH /reviews/{id} já conferida"
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$BASE/reviews/$ID/timeline")" "GET  /reviews/{id}/timeline"

echo
printf '\033[0;32m✓ smoke test passou\033[0m — solicitação %s\n' "${ID:0:8}…"
