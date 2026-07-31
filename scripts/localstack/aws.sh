#!/usr/bin/env bash
# =============================================================================
# Wrapper do AWS CLI apontado para o LocalStack deste projeto.
#
# Por que não `awslocal`: ele assume a porta 4566, e este projeto sobe o
# LocalStack em outra porta justamente para não colidir com outra instância
# na máquina. Um comando copiado da doc acertaria a instância errada em silêncio.
#
# Uso:  ./scripts/localstack/aws.sh <comando aws...>
#       ./scripts/localstack/aws.sh rds describe-db-instances
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT_DIR/.env" ] && set -a && source "$ROOT_DIR/.env" && set +a

LOCALSTACK_PORT="${LOCALSTACK_PORT:-4568}"
ENDPOINT="http://localhost:${LOCALSTACK_PORT}"

# O LocalStack aceita qualquer credencial, mas o CLI exige que existam.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_PAGER=""

exec aws --endpoint-url="$ENDPOINT" "$@"
