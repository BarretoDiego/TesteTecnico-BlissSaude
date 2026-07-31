#!/usr/bin/env bash
# =============================================================================
# Inventário do que o Terraform criou na AWS local.
#
# O LocalStack Community não tem console web — o painel do app.localstack.cloud
# exige conta. Este script é o substituto: mostra Lambdas, API Gateway, rotas,
# log groups e segredos como um console mostraria.
#
# Uso:  ./scripts/resources.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

AWS="./scripts/localstack/aws.sh"
titulo() { printf '\n\033[1;36m━━━ %s ━━━\033[0m\n' "$*"; }

$AWS sts get-caller-identity >/dev/null 2>&1 || {
	printf '\033[0;31m✗\033[0m LocalStack não responde — rode \033[0;36mpnpm start\033[0m\n'
	exit 1
}

titulo "Lambdas"
# Chaves entre aspas: o JMESPath só aceita acento em identificador citado.
$AWS lambda list-functions \
	--query 'sort_by(Functions, &FunctionName)[].{"Função":FunctionName,"Runtime":Runtime,"Memória":MemorySize,"Timeout":Timeout}' \
	--output table

titulo "API Gateway"
API_ID="$($AWS apigateway get-rest-apis --query 'items[0].id' --output text)"
$AWS apigateway get-rest-apis --query 'items[].{Id:id,Nome:name}' --output table

titulo "Rotas publicadas"
# `authorizationType` na tabela de propósito: é o que prova que as rotas de
# negócio exigem token e que os healthchecks ficam de fora, sem abrir o HCL.
$AWS apigateway get-resources --rest-api-id "$API_ID" \
	--query 'sort_by(items[?resourceMethods], &path)[].[path, join(`, `, keys(resourceMethods))]' \
	--output text | while read -r caminho metodos; do
	printf '  %-34s %s\n' "$caminho" "$metodos"
done

titulo "Autorização por método"
$AWS apigateway get-resources --rest-api-id "$API_ID" --embed methods \
	--query 'items[?resourceMethods].[path, resourceMethods]' --output json |
	python3 -c '
import json, sys
for caminho, metodos in sorted(json.load(sys.stdin)):
    for verbo, definicao in sorted(metodos.items()):
        # Preflight é sempre NONE — o browser não manda credencial no OPTIONS.
        if verbo == "OPTIONS":
            continue
        tipo = definicao.get("authorizationType", "?")
        print("  %-7s %-34s %s" % (verbo, caminho, tipo))
'

titulo "Log groups (CloudWatch)"
$AWS logs describe-log-groups --query 'sort_by(logGroups, &logGroupName)[].logGroupName' --output table

titulo "Secrets Manager"
$AWS secretsmanager list-secrets --query 'sort_by(SecretList, &Name)[].Name' --output table

printf '\n\033[0;90mQualquer comando da AWS CLI funciona pelo wrapper:\033[0m\n'
printf '  ./scripts/localstack/aws.sh lambda get-function --function-name saude-bliss-bliss-requests-local\n\n'
