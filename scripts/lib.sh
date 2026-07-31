#!/usr/bin/env bash
# =============================================================================
# Funções compartilhadas por start.sh e stop.sh.
#
# Existem aqui porque os dois precisam responder a **mesma** pergunta — "qual
# processo deste repositório está servindo o backoffice?" — e responder diferente
# é como o start adota um servidor que o stop não consegue derrubar.
# =============================================================================

# Imprime os PIDs que escutam a porta e pertencem a este repositório.
#
# A identificação é pelo diretório de trabalho, e não pela linha de comando: o
# Next renomeia o próprio processo para `next-server (vX)`, e o caminho do
# projeto some de `ps`. Também descarta o proxy do OrbStack/Docker Desktop, que
# escuta na mesma porta com `cwd=/` e responde HTTP mesmo sem servidor vivo.
web_listeners() {
	local raiz="$1" porta="$2" pid cwd
	for pid in $(lsof -t -iTCP:"$porta" -sTCP:LISTEN 2>/dev/null); do
		cwd="$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p')"
		if [ "$cwd" = "$raiz" ] || [ "${cwd#"$raiz"/}" != "$cwd" ]; then
			printf '%s\n' "$pid"
		fi
	done
}

# Derruba um processo e toda a sua descendência.
#
# `pnpm dev:web` gera pnpm → next dev → next-server. Matar só o PID do pidfile
# deixa o neto servindo a porta: o start seguinte o adota e o stop nunca o
# alcança, então a porta some para sempre até alguém achar o processo à mão.
kill_arvore() {
	local pid="$1" filho
	for filho in $(pgrep -P "$pid" 2>/dev/null); do
		kill_arvore "$filho"
	done
	kill "$pid" 2>/dev/null || true
}
