#!/usr/bin/env bash
# =============================================================================
# Deploy local completo: build → terraform → migrations → seed → smoke.
#
# A ordem importa. O Terraform lê o zip pelo `filebase64sha256`, então o build
# precisa vir antes — senão o apply falha por arquivo inexistente, ou pior,
# publica o artefato da execução anterior.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env && set +a

TF_DIR="infra/terraform"
TFVARS="environments/${TF_ENV:-local}.tfvars"

log() { printf '\n\033[0;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }

log "1/6 · aguardando a infraestrutura local"
./scripts/localstack/wait-ready.sh

log "2/6 · empacotando os microserviços"
# Build antes do Terraform: ele consome o zip pelo hash do conteúdo.
pnpm --filter "./apps/api/functions/*" build

log "3/6 · verificando paridade de rotas"
pnpm --filter @saude-bliss/api check:routes

log "4/6 · provisionando (terraform apply)"
terraform -chdir="$TF_DIR" init -input=false >/dev/null
terraform -chdir="$TF_DIR" apply -var-file="$TFVARS" -auto-approve

log "5/6 · aplicando migrations e seed"
# A connection string vem do output do Terraform, não de um valor fixo: assim o
# host acompanha o que foi provisionado, seja o RDS emulado ou o fallback.
DATABASE_URL="$(terraform -chdir="$TF_DIR" output -raw database_url)"
export DATABASE_URL
pnpm --filter @saude-bliss/database db:migrate
pnpm --filter @saude-bliss/database db:seed

log "6/6 · smoke test"
./scripts/localstack/smoke.sh

echo
ok "deploy local concluído"
terraform -chdir="$TF_DIR" output service_urls
