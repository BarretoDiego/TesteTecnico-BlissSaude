#!/usr/bin/env bash
# =============================================================================
# Derruba o que `start.sh` subiu.
#
# O backoffice é morto pelo pidfile **e** pelos listeners da porta que pertencem
# a este repositório — não por `pkill -f "next dev"`, que casaria com o servidor
# de qualquer outro projeto Next aberto na máquina.
#
# Uso:
#   ./scripts/stop.sh          # para os containers, preserva os dados
#   ./scripts/stop.sh --limpar # remove também os volumes (banco do zero)
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib.sh"

WEB_PORT="${WEB_PORT:-3000}"
WEB_PID="$ROOT_DIR/.web.pid"
ok() { printf '\033[0;32m✓\033[0m %s\n' "$*"; }

# 1. O processo do pidfile, com toda a descendência.
if [ -f "$WEB_PID" ]; then
	pid="$(cat "$WEB_PID")"
	if kill -0 "$pid" 2>/dev/null; then
		kill_arvore "$pid"
		ok "backoffice parado (pid $pid)"
	fi
	rm -f "$WEB_PID"
fi

# 2. E qualquer sobrevivente ainda segurando a porta. O `next dev` gera netos, e
#    sem esta varredura um deles ficaria servindo uma versão que ninguém mais
#    consegue derrubar — o start seguinte o adotaria como se fosse novo.
sleep 1
for pid in $(web_listeners "$ROOT_DIR" "$WEB_PORT"); do
	kill_arvore "$pid"
	ok "processo remanescente na porta $WEB_PORT encerrado (pid $pid)"
done

if [ "${1:-}" = "--limpar" ]; then
	docker compose down -v
	ok "containers e volumes removidos — o próximo start recria o banco do zero"
else
	docker compose down
	ok "containers parados (dados preservados)"
fi
