#!/usr/bin/env bash
# =============================================================================
# Deploy pela trilha do Serverless Framework.
#
# Alternativa completa ao `scripts/localstack/deploy.sh`, que usa Terraform. As
# duas provisionam o mesmo sistema; esta em stage `sls`, aquela em `local`, e
# por isso coexistem sem disputar recurso.
#
# Uso:
#   ./scripts/serverless/deploy.sh            # deploy + migrations + smoke
#   ./scripts/serverless/deploy.sh --remover  # derruba o stack
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env && set +a

API_DIR="$ROOT_DIR/apps/api"
ARTIFACTS="$API_DIR/.artifacts"
STAGE="${SLS_STAGE:-sls}"
SERVICOS=(bliss-requests bliss-reviews bliss-auth bliss-authorizer)

# O LocalStack aceita qualquer credencial, mas o SDK exige que existam.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

log() { printf '\n\033[0;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }

# --- remoção ------------------------------------------------------------------
if [ "${1:-}" = "--remover" ]; then
	log "removendo o stack $STAGE"
	# Direto pelo CloudFormation, e não por `sls remove`: o `remove` tenta limpar
	# imagens no ECR, que o LocalStack Community não implementa, e aborta antes
	# de apagar o que interessa.
	"$ROOT_DIR/scripts/localstack/aws.sh" cloudformation delete-stack \
		--stack-name "saude-bliss-api-${STAGE}" >/dev/null 2>&1 || true

	for _ in $(seq 1 30); do
		"$ROOT_DIR/scripts/localstack/aws.sh" cloudformation describe-stacks \
			--stack-name "saude-bliss-api-${STAGE}" >/dev/null 2>&1 || {
			ok "stack removido"
			exit 0
		}
		sleep 2
	done
	printf '\033[0;31m✗\033[0m o stack não terminou de sair em 60s\n'
	exit 1
fi

# --- 1. infraestrutura --------------------------------------------------------
log "1/5 · aguardando a infraestrutura local"
./scripts/localstack/wait-ready.sh

# --- 2. build -----------------------------------------------------------------
log "2/5 · empacotando os microserviços"
pnpm --filter "./apps/api/functions/*" build

# --- 3. artefatos com nome próprio --------------------------------------------
log "3/5 · preparando os artefatos"
# O Serverless usa o **nome do arquivo** como chave no S3. Os quatro bundles se
# chamam `function.zip`, então apontá-los direto faz os quatro subirem para a
# mesma chave: o último vence e todas as funções passam a rodar o mesmo código.
# O sintoma é péssimo de ler — a função de requests responde com log do
# authorizer. Copiar com nome por serviço resolve na origem.
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"
for servico in "${SERVICOS[@]}"; do
	origem="$API_DIR/functions/$servico/dist/function.zip"
	[ -f "$origem" ] || {
		printf '\033[0;31m✗\033[0m artefato ausente: %s\n' "$origem"
		exit 1
	}
	cp "$origem" "$ARTIFACTS/$servico.zip"
done
ok "$(ls -1 "$ARTIFACTS" | wc -l | tr -d ' ') artefatos prontos"

# --- 4. deploy ----------------------------------------------------------------
log "4/5 · provisionando (serverless deploy)"
(cd "$API_DIR" && npx serverless deploy --stage "$STAGE")

# O output vem indentado sob `Stack Outputs:` — daí o `[[:space:]]*` no padrão.
API_BASE_URL="$(cd "$API_DIR" && npx serverless info --stage "$STAGE" --verbose 2>/dev/null |
	sed -n 's/^[[:space:]]*ApiBaseUrl:[[:space:]]*//p' | tail -1)"

[ -n "$API_BASE_URL" ] || {
	printf '\033[0;31m✗\033[0m não foi possível ler a URL da API dos outputs do stack\n'
	exit 1
}

# --- 5. migrations, seed e smoke ----------------------------------------------
log "5/5 · migrations, seed e smoke"
DATABASE_URL="postgresql://${POSTGRES_USER:-saudebliss}:${POSTGRES_PASSWORD:-saudebliss}@localhost:${POSTGRES_PORT:-5433}/${POSTGRES_DB:-saudebliss}"
export DATABASE_URL
pnpm --filter @saude-bliss/database db:migrate
pnpm --filter @saude-bliss/database db:seed

# O smoke resolve o alvo por variável, então serve às duas trilhas sem cópia.
# Os nomes vão explícitos porque o padrão dele são os outputs do Terraform, que
# descrevem o **outro** deploy — e apontar para lá daria um verde enganoso.
API_ID="$(printf '%s' "$API_BASE_URL" | sed -n 's|.*/restapis/\([^/]*\)/.*|\1|p')"
export API_BASE_URL
export API_ID
export API_STAGE="$STAGE"
export AUTHORIZER_FUNCTION="saude-bliss-api-${STAGE}-authorizer"
./scripts/localstack/smoke.sh

printf '\n\033[0;32m✓\033[0m deploy pela trilha do Serverless Framework concluído\n'
printf '  API: \033[0;36m%s\033[0m\n\n' "$API_BASE_URL"
