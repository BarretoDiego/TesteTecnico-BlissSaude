#!/usr/bin/env bash
# =============================================================================
# Exporta os outputs do Terraform para os `.env.local` das aplicações.
#
# Evita copiar URL e id de segredo à mão depois de cada apply — que é como
# backoffice e automação acabam apontando para um deploy antigo.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"

API_BASE_URL="$(terraform -chdir="$TF_DIR" output -raw api_base_url)"
DATABASE_URL="$(terraform -chdir="$TF_DIR" output -raw database_url)"
DB_SECRET_ID="$(terraform -chdir="$TF_DIR" output -raw database_secret_id)"

cat >"$ROOT_DIR/apps/api/.env.local" <<ENV
# Gerado por scripts/localstack/export-outputs.sh — não edite à mão.
DATABASE_URL=$DATABASE_URL
DB_SECRET_ID=$DB_SECRET_ID
ENV

cat >"$ROOT_DIR/apps/web/.env.local" <<ENV
# Gerado por scripts/localstack/export-outputs.sh — não edite à mão.
NEXT_PUBLIC_API_BASE_URL=$API_BASE_URL
API_BASE_URL=$API_BASE_URL
ENV

cat >"$ROOT_DIR/apps/automation/.env" <<ENV
# Gerado por scripts/localstack/export-outputs.sh — não edite à mão.
API_BASE_URL=$API_BASE_URL
WEB_BASE_URL=http://localhost:3000
ENV

printf '\033[0;32m✓\033[0m outputs exportados\n  API_BASE_URL=%s\n  DB_SECRET_ID=%s\n' "$API_BASE_URL" "$DB_SECRET_ID"
