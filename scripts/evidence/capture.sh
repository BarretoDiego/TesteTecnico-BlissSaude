#!/usr/bin/env bash
# =============================================================================
# Captura as evidências de execução em docs/evidence/.
#
# Evidência é entregável, não pós-produção: deploy e execução da automação
# precisam de prova. Roteirizar a captura garante que ela reflita o estado atual
# do código, e não uma sessão manual de meses atrás.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT_DIR/docs/evidence"
mkdir -p "$OUT"
cd "$ROOT_DIR"

BASE="${API_BASE_URL:-http://localhost:4000/v1}"
log() { printf '\n\033[0;36m▸ %s\033[0m\n' "$*"; }

log "1/4 · endpoints da API"
{
	echo "# Evidência — endpoints"
	echo
	echo "> Capturado em $(date -u +%Y-%m-%dT%H:%M:%SZ) contra \`$BASE\`"
	echo

	TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
		-d '{"email":"daniel.morais@saudebliss.test","password":"saudebliss123"}' |
		python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')

	TRACE="evidencia-$(date +%s)"

	echo '## `POST /requests` → 201'
	echo
	echo '```http'
	echo "POST $BASE/requests"
	echo "x-request-id: $TRACE"
	echo '```'
	echo '```json'
	curl -s -X POST "$BASE/requests" -H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' -H "x-request-id: $TRACE" \
		-d '{"title":"Evidência de deploy","description":"Solicitação criada pelo script de evidências para demonstrar o fluxo completo.","priority":"high","createdBy":"evidencia@saudebliss.test"}' |
		python3 -m json.tool
	echo '```'
	echo

	ID=$(curl -s -G "$BASE/requests" -H "Authorization: Bearer $TOKEN" \
		--data-urlencode "createdBy=evidencia@saudebliss.test" --data-urlencode "pageSize=1" |
		python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["items"][0]["id"])')

	echo '## `GET /requests/{id}` → 200'
	echo '```json'
	curl -s "$BASE/requests/$ID" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
	echo '```'
	echo

	echo '## `GET /requests/{id}` inexistente → 404'
	echo '```json'
	curl -s "$BASE/requests/00000000-0000-4000-8000-999999999999" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
	echo '```'
	echo

	echo '## `GET /requests?createdBy=&status=` → 200'
	echo '```json'
	curl -s -G "$BASE/requests" -H "Authorization: Bearer $TOKEN" \
		--data-urlencode "status=open" --data-urlencode "createdBy=evidencia@saudebliss.test" |
		python3 -c 'import sys,json;d=json.load(sys.stdin);d["data"]["items"]=d["data"]["items"][:2];print(json.dumps(d,indent=4,ensure_ascii=False))'
	echo '```'
	echo

	echo '## `POST /requests` inválido → 400'
	echo '```json'
	curl -s -X POST "$BASE/requests" -H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' -d '{"title":"ab","priority":"urgente"}' | python3 -m json.tool
	echo '```'
	echo

	echo '## `PATCH /reviews/{id}` conferida duas vezes → 200 e 409'
	echo '```json'
	curl -s -X PATCH "$BASE/reviews/$ID" -H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' -d '{"reviewedBy":"daniel.morais@saudebliss.test","status":"reviewed"}' | python3 -m json.tool
	curl -s -X PATCH "$BASE/reviews/$ID" -H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' -d '{"reviewedBy":"outro@saudebliss.test","status":"reviewed"}' | python3 -m json.tool
	echo '```'
	echo

	echo "## Rastreabilidade — \`$TRACE\`"
	echo
	echo 'O id enviado pelo cliente volta no envelope, no header `x-request-id` e é'
	echo 'persistido em `requests.created_trace_id`:'
	echo
	echo '```'
	docker compose exec -T postgres psql -U saudebliss -d saudebliss -tAc \
		"select created_trace_id, status, priority, title from requests where created_trace_id='$TRACE'" 2>/dev/null || echo "(banco indisponível)"
	echo '```'
} >"$OUT/api-endpoints.md"

log "2/4 · suíte de testes"
{
	echo "# Evidência — testes"
	echo
	echo "> Capturado em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo
	echo '```'
	for pkg in packages/core apps/api/functions/bliss-auth apps/api/functions/bliss-authorizer \
		apps/api/functions/bliss-requests apps/api/functions/bliss-reviews; do
		printf '%-20s ' "$(basename "$pkg")"
		(cd "$pkg" && npx jest 2>&1 | grep -oE "Tests: +[0-9]+ passed, +[0-9]+ total" || echo "falhou")
	done
	echo '```'
} >"$OUT/testes.md"

log "3/4 · paridade de rotas"
{
	echo "# Evidência — paridade de rotas"
	echo
	echo 'Cada rota é declarada no router do Fastify, no mapa `routes` do Terraform e —'
	echo 'só o prefixo — no `serverless.yml`. Este verificador compara os três.'
	echo
	echo '```'
	pnpm --silent --filter @saude-bliss/api check:routes 2>&1
	echo '```'
} >"$OUT/rotas.md"

log "4/4 · automação da conferência"
{
	echo "# Evidência — automação da conferência"
	echo
	echo "> Capturado em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo
	echo '```'
	(cd apps/automation && npx playwright test --project=chromium-headless 2>&1 | tail -30)
	echo '```'
	echo
	echo '## Relatório CSV'
	echo
	echo 'Gerado por um `Reporter`, e não dentro do teste, para sair mesmo quando a'
	echo 'suíte falha — que é quando a operação precisa dele.'
	echo
	echo '```csv'
	head -8 apps/automation/reports/conferencia-*.csv 2>/dev/null || echo "(sem relatório)"
	echo '```'
} >"$OUT/automacao.md"

printf '\n\033[0;32m✓\033[0m evidências em docs/evidence/\n'
ls -1 "$OUT"
