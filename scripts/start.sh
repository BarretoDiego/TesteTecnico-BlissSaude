#!/usr/bin/env bash
# =============================================================================
# Do zero ao sistema no ar, em um comando.
#
# Encadeia o que antes eram cinco passos manuais na ordem certa — e a ordem é
# toda a razão de existir do script: o Terraform lê o zip pelo hash do conteúdo,
# as migrations precisam da URL que o apply produziu, e o backoffice precisa da
# URL do API Gateway antes de subir. Errar a ordem falha de formas que não se
# parecem com a causa.
#
# Idempotente: rodar de novo com tudo no ar reaproveita o que já existe.
#
# Uso:  ./scripts/start.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib.sh"

WEB_PORT="${WEB_PORT:-3000}"
WEB_LOG="$ROOT_DIR/.web.log"
WEB_PID="$ROOT_DIR/.web.pid"

log() { printf '\n\033[0;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }

# --- 1. pré-requisitos -------------------------------------------------------
log "1/5 · verificando pré-requisitos"
faltando=()
for cmd in docker pnpm terraform aws; do
	command -v "$cmd" >/dev/null 2>&1 || faltando+=("$cmd")
done
if [ ${#faltando[@]} -gt 0 ]; then
	printf '\033[0;31m✗\033[0m faltam ferramentas: %s\n' "${faltando[*]}"
	printf '  macOS: brew install %s\n' "${faltando[*]}"
	exit 1
fi
docker info >/dev/null 2>&1 || {
	printf '\033[0;31m✗\033[0m o Docker não está rodando — inicie o Docker Desktop ou o OrbStack\n'
	exit 1
}
# `.env` na raiz: o compose e os scripts leem dele. Sem isso o LocalStack sobe
# na porta errada e o `aws.sh` acerta outra instância.
[ -f .env ] || {
	cp .env.example .env
	ok ".env criado a partir do .env.example"
}
[ -d node_modules ] || {
	log "instalando dependências"
	pnpm install
}
ok "pré-requisitos atendidos"

# --- 2. infraestrutura -------------------------------------------------------
log "2/5 · subindo LocalStack e Postgres"
docker compose up -d
./scripts/localstack/wait-ready.sh

# --- 3. deploy ---------------------------------------------------------------
log "3/5 · empacotando e provisionando (Terraform → LocalStack)"
./scripts/localstack/deploy.sh

# --- 4. variáveis das aplicações ---------------------------------------------
log "4/5 · exportando os endereços para as aplicações"
./scripts/localstack/export-outputs.sh

# --- 5. backoffice -----------------------------------------------------------
log "5/5 · subindo o backoffice"

# O sinal de "já está no ar" é **um processo deste repositório escutando a
# porta**, e não "alguma coisa responde HTTP nela". A distinção não é teórica:
# OrbStack e Docker Desktop deixam um proxy escutando na porta mesmo depois que o
# servidor morre, e ele responde 302 — bastaria isso para o script concluir que a
# porta está ocupada e recusar subir logo após um `pnpm stop`.
#
# A identificação é pelo **diretório de trabalho** do processo, não pela linha de
# comando: o Next se renomeia para `next-server (vX)` e o caminho do projeto
# some de `ps`. Cobre também quem rodou `pnpm dev:web` à mão antes do start.
nosso="$(web_listeners "$ROOT_DIR" "$WEB_PORT" | head -1)"
[ -n "$nosso" ] && echo "$nosso" >"$WEB_PID"

if [ -n "$nosso" ]; then
	# O Next recarrega o `.env.local` sozinho, então a URL nova do gateway já vale.
	ok "backoffice já estava no ar (pid $nosso)"
else
	# Em background com pidfile: `pnpm stop` precisa saber o que derrubar, e
	# `pkill -f "next dev"` mataria o servidor de outro projeto na mesma máquina.
	pnpm dev:web >"$WEB_LOG" 2>&1 &
	echo $! >"$WEB_PID"

	pronto=0
	for _ in $(seq 1 60); do
		# Espera um listener **deste repositório** e uma resposta HTTP. Só o `curl`
		# não basta: o proxy do OrbStack responde na porta e daria por pronto um
		# servidor que nem chegou a subir.
		if [ -n "$(web_listeners "$ROOT_DIR" "$WEB_PORT" | head -1)" ] &&
			curl -sf "http://localhost:${WEB_PORT}" >/dev/null 2>&1; then
			pronto=1
			break
		fi
		sleep 1
	done

	if [ "$pronto" -eq 1 ]; then
		ok "backoffice no ar (pid $(cat "$WEB_PID"), log em .web.log)"
	else
		printf '\033[0;31m✗\033[0m o backoffice não respondeu em 60s. Últimas linhas de .web.log:\n'
		tail -15 "$WEB_LOG" 2>/dev/null | sed 's/^/  /'
		printf '  Se a porta %s estiver em uso por outro projeto: \033[0;36mWEB_PORT=3001 pnpm start\033[0m\n' "$WEB_PORT"
		exit 1
	fi
fi

./scripts/urls.sh
