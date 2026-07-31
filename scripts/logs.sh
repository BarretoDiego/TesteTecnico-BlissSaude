#!/usr/bin/env bash
# =============================================================================
# Logs das Lambdas no CloudWatch.
#
# Existe sobretudo para demonstrar a rastreabilidade: filtrar por um `requestId`
# devolve a requisição inteira atravessando controller, service e repositório —
# que é o que o desafio pede para ser demonstrável.
#
# Uso:
#   ./scripts/logs.sh                        # últimas linhas de todos os serviços
#   ./scripts/logs.sh requests               # só de um serviço
#   ./scripts/logs.sh --trace meu-request-id # a requisição inteira, em todos
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

AWS="./scripts/localstack/aws.sh"
SERVICOS=(requests reviews auth authorizer)
LINHAS="${LINHAS:-40}"

titulo() { printf '\n\033[1;36m━━━ bliss-%s ━━━\033[0m\n' "$1"; }

grupo_de() { printf '/aws/lambda/saude-bliss-bliss-%s-local' "$1"; }

# --- filtro por trace --------------------------------------------------------
if [ "${1:-}" = "--trace" ]; then
	TRACE="${2:?informe o requestId: ./scripts/logs.sh --trace <requestId>}"
	encontrou=0

	for servico in "${SERVICOS[@]}"; do
		# O `--filter-pattern` é enviado, mas o LocalStack não o honra — o recorte
		# de fato acontece no `grep` abaixo. Mantê-lo assim faz o mesmo comando
		# funcionar contra a AWS real, onde o filtro poupa transferência.
		saida="$($AWS logs filter-log-events \
			--log-group-name "$(grupo_de "$servico")" \
			--filter-pattern "$TRACE" \
			--query 'events[].message' --output text 2>/dev/null |
			tr '\t' '\n' | grep -F "$TRACE" | grep -E '"requestId"' || true)"
		[ -z "$saida" ] && continue

		encontrou=1
		titulo "$servico"
		# Só as linhas da aplicação: o ruído do runtime (START/END/REPORT, avisos
		# do SDK) enterraria o que interessa.
		printf '%s\n' "$saida"
	done

	[ "$encontrou" -eq 0 ] && printf '\033[0;33m!\033[0m nenhuma linha com o trace %s\n' "$TRACE"
	exit 0
fi

# --- últimas linhas ----------------------------------------------------------
alvos=("${SERVICOS[@]}")
[ -n "${1:-}" ] && alvos=("$1")

for servico in "${alvos[@]}"; do
	titulo "$servico"
	$AWS logs filter-log-events \
		--log-group-name "$(grupo_de "$servico")" \
		--query 'events[].message' --output text 2>/dev/null |
		tr '\t' '\n' | grep -E '"requestId"|"level"' | tail -n "$LINHAS" ||
		printf '  (sem linhas — o serviço ainda não foi invocado)\n'
done

printf '\n\033[0;90mPara seguir uma requisição específica ponta a ponta:\033[0m\n'
printf '  ./scripts/logs.sh --trace <requestId>\n\n'
