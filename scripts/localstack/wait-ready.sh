#!/usr/bin/env bash
# =============================================================================
# Espera o LocalStack e o Postgres ficarem prontos.
#
# O healthcheck do compose responde antes dos serviços estarem realmente
# utilizáveis — serviços do LocalStack são lazy-loaded e só saem de "disabled"
# na primeira chamada. Por isso a checagem é ativa, não só um GET no /health.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT_DIR/.env" ] && set -a && source "$ROOT_DIR/.env" && set +a

LOCALSTACK_PORT="${LOCALSTACK_PORT:-4568}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"
TIMEOUT="${WAIT_TIMEOUT:-180}"

log() { printf '\033[0;36m›\033[0m %s\n' "$*"; }
ok() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
die() {
	printf '\033[0;31m✗\033[0m %s\n' "$*" >&2
	exit 1
}

# --- Postgres --------------------------------------------------------------
log "aguardando Postgres em localhost:${POSTGRES_PORT}"
deadline=$((SECONDS + TIMEOUT))
until docker compose exec -T postgres pg_isready -q 2>/dev/null; do
	[ $SECONDS -ge $deadline ] && die "Postgres não respondeu em ${TIMEOUT}s"
	sleep 2
done
ok "Postgres pronto"

# --- LocalStack ------------------------------------------------------------
log "aguardando LocalStack em localhost:${LOCALSTACK_PORT}"
deadline=$((SECONDS + TIMEOUT))
until curl -sf "http://localhost:${LOCALSTACK_PORT}/_localstack/health" >/dev/null 2>&1; do
	[ $SECONDS -ge $deadline ] && die "LocalStack não respondeu em ${TIMEOUT}s"
	sleep 2
done

# Licença Pro é opcional: só a emulação de RDS depende dela, e o padrão do
# Terraform (`create_rds_instance = false`) usa o Postgres do compose.
if curl -s "http://localhost:${LOCALSTACK_PORT}/_localstack/info" | grep -q '"is_license_activated": *true'; then
	ok "LocalStack pronto (Pro, licença ativa — RDS emulado disponível)"
else
	ok "LocalStack pronto (Community — use o Postgres do compose para o banco)"
fi

# Força o carregamento lazy dos serviços que o Terraform vai usar. Sem isso a
# primeira chamada do apply paga o tempo de boot e às vezes estoura timeout.
log "aquecendo serviços (lambda, apigateway, secretsmanager, iam, logs)"
for svc in "lambda list-functions" "apigateway get-rest-apis" \
	"secretsmanager list-secrets" "iam list-roles" "logs describe-log-groups"; do
	# shellcheck disable=SC2086
	"$ROOT_DIR/scripts/localstack/aws.sh" $svc >/dev/null 2>&1 || true
done
ok "serviços aquecidos"

ok "infraestrutura local pronta"
