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

check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests/health")" "GET  /requests/health"
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/reviews/health")" "GET  /reviews/health"

# --- criação ---------------------------------------------------------------
TRACE="smoke-$(date +%s)"
BODY=$(curl -s -X POST "$BASE/requests" \
	-H 'Content-Type: application/json' -H "x-request-id: $TRACE" \
	-d '{"title":"Smoke test de deploy","description":"Solicitação criada pelo smoke test para validar o deploy.","priority":"high","createdBy":"smoke@saudebliss.test"}')
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/requests" \
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
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests/$ID")" "GET  /requests/{id}"
check 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests/00000000-0000-4000-8000-999999999999")" "GET  /requests/{id} inexistente"
check 400 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests/nao-e-uuid")" "GET  /requests/{id} malformado"
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests?status=open")" "GET  /requests?status="
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/requests?createdBy=smoke@saudebliss.test")" "GET  /requests?createdBy="
check 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/requests" -H 'Content-Type: application/json' -d '{"title":"ab"}')" "POST /requests inválido"

# --- conferência (outro microserviço) --------------------------------------
check 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/reviews/$ID" \
	-H 'Content-Type: application/json' -d '{"reviewedBy":"smoke@saudebliss.test","status":"reviewed"}')" "PATCH /reviews/{id}"
check 409 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/reviews/$ID" \
	-H 'Content-Type: application/json' -d '{"reviewedBy":"outro@saudebliss.test","status":"reviewed"}')" "PATCH /reviews/{id} já conferida"
check 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/reviews/$ID/timeline")" "GET  /reviews/{id}/timeline"

echo
printf '\033[0;32m✓ smoke test passou\033[0m — solicitação %s\n' "${ID:0:8}…"
