#!/usr/bin/env bash
# =============================================================================
# Onde o sistema está e como entrar nele.
#
# As URLs do LocalStack carregam o id do REST API, que muda a cada `terraform
# destroy`/`apply`. Lê-las do output do Terraform em vez de documentá-las fixas é
# o que impede a doc de apontar para um deploy que não existe mais.
#
# Uso:  ./scripts/urls.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env && set +a

WEB_PORT="${WEB_PORT:-3000}"
LOCALSTACK_PORT="${LOCALSTACK_PORT:-4568}"

titulo() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
item() { printf '  %-22s \033[0;36m%s\033[0m\n' "$1" "$2"; }

API_BASE_URL="$(terraform -chdir=infra/terraform output -raw api_base_url 2>/dev/null || true)"

# A trilha do Serverless Framework, quando implantada, aparece ao lado da do
# Terraform: as duas coexistem em stages diferentes, e ver as duas URLs juntas é
# o que torna a coexistência verificável em vez de afirmada.
SLS_BASE_URL="$(cd apps/api 2>/dev/null &&
	AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test npx --no-install serverless info --stage "${SLS_STAGE:-sls}" --verbose 2>/dev/null |
	sed -n 's/^[[:space:]]*ApiBaseUrl:[[:space:]]*//p' | tail -1)"

titulo "Sistema"
if [ -n "$API_BASE_URL" ] || [ -n "$SLS_BASE_URL" ]; then
	item "Backoffice" "http://localhost:${WEB_PORT}"
	[ -n "$API_BASE_URL" ] && item "API — Terraform" "$API_BASE_URL"
	[ -n "$SLS_BASE_URL" ] && item "API — Serverless" "$SLS_BASE_URL"
else
	printf '  \033[0;33m!\033[0m nada provisionado ainda — rode \033[0;36mpnpm start\033[0m\n'
	exit 0
fi

titulo "Credenciais (do seed — todas com a senha saudebliss123)"
item "admin + conferência" "daniel.morais@saudebliss.test"
item "conferência" "carla.mendes@saudebliss.test"
item "abertura" "ana.souza@saudebliss.test"

titulo "Telas"
item "Solicitações" "http://localhost:${WEB_PORT}/solicitacoes"
item "Nova solicitação" "http://localhost:${WEB_PORT}/solicitacoes/nova"
item "Conferência" "http://localhost:${WEB_PORT}/conferencia"
item "Status dos serviços" "http://localhost:${WEB_PORT}/status"

titulo "Infraestrutura"
item "LocalStack (saúde)" "http://localhost:${LOCALSTACK_PORT}/_localstack/health"
item "Postgres" "localhost:${POSTGRES_PORT:-5433} (${POSTGRES_USER:-saudebliss}/${POSTGRES_DB:-saudebliss})"

titulo "Comandos"
item "pnpm resources" "recursos criados na AWS local"
item "pnpm logs" "logs das Lambdas no CloudWatch"
item "pnpm verify" "verificação ponta a ponta"
item "pnpm stop" "derruba tudo"

printf '\n\033[0;90mExemplo — o requestId enviado volta no envelope e vai para os logs:\033[0m\n'
printf "  curl -s '%s/requests?status=open' -H 'x-request-id: meu-teste'\n\n" "$API_BASE_URL"
