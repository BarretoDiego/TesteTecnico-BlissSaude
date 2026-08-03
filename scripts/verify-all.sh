#!/usr/bin/env bash
# =============================================================================
# Verificação ponta a ponta de todos os cenários operacionais.
#
# Não substitui as suítes automatizadas — verifica o que elas não alcançam: que o
# projeto **sobe do zero**, que cada microserviço roda isolado como roda em
# produção, que o modo agregado se comporta igual, que a autenticação funciona de
# verdade contra o banco, e que o deploy no LocalStack entrega uma API utilizável.
#
# É o roteiro que alguém executaria à mão antes de entregar. Roteirizá-lo garante
# que seja executado inteiro, na mesma ordem, e que o resultado seja comparável
# entre execuções.
#
# Uso:
#   ./scripts/verify-all.sh            # tudo
#   ./scripts/verify-all.sh --rapido   # pula o deploy no LocalStack (~2 min)
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
[ -f .env ] && set -a && source .env && set +a

RAPIDO=0
[ "${1:-}" = "--rapido" ] && RAPIDO=1

PASSOU=0
FALHOU=0
FALHAS=()

# --- saída -------------------------------------------------------------------
titulo() { printf '\n\033[1;36m━━━ %s ━━━\033[0m\n' "$*"; }
passo() { printf '\033[0;36m  ▸\033[0m %s\n' "$*"; }
ok() {
	printf '  \033[0;32m✓\033[0m %s\n' "$*"
	PASSOU=$((PASSOU + 1))
}
falha() {
	printf '  \033[0;31m✗\033[0m %s\n' "$*"
	FALHOU=$((FALHOU + 1))
	FALHAS+=("$*")
}

# `verificar <esperado> <obtido> <descrição>`
verificar() {
	if [ "$1" = "$2" ]; then ok "$3 → $2"; else falha "$3 → esperado [$1], obtido [$2]"; fi
}

# `verificar_contem <agulha> <palheiro> <descrição>`
verificar_contem() {
	case "$2" in
	*"$1"*) ok "$3" ;;
	*) falha "$3 — não encontrou [$1]" ;;
	esac
}

http() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
json() { curl -s --max-time 20 "$@"; }

# Aguarda uma URL responder. Espera ativa em vez de `sleep` fixo: um tempo fixo
# ou é lento demais ou é curto demais, e é a origem clássica de script instável.
aguardar() { # <url> <segundos>
	local prazo=$((SECONDS + ${2:-60}))
	until curl -sf --max-time 3 "$1" >/dev/null 2>&1; do
		[ $SECONDS -ge $prazo ] && return 1
		sleep 2
	done
	return 0
}

encerrar_servidores() {
	pkill -f "run.all.local" 2>/dev/null || true
	pkill -f "functions/bliss-.*run.local" 2>/dev/null || true
	pkill -f "ts-node-dev.*run.local" 2>/dev/null || true
	pkill -f "next dev" 2>/dev/null || true
	sleep 2
}

# Aguarda uma porta ficar livre. Um servidor sobrevivente de execução anterior
# faz o processo novo abortar com EADDRINUSE — e, pior, as verificações passam
# medindo o servidor **antigo**, que pode estar rodando código desatualizado.
aguardar_porta_livre() { # <porta>
	local prazo=$((SECONDS + 30))
	while lsof -ti ":$1" >/dev/null 2>&1; do
		[ $SECONDS -ge $prazo ] && return 1
		lsof -ti ":$1" | xargs kill -9 2>/dev/null || true
		sleep 1
	done
	return 0
}

trap encerrar_servidores EXIT

# Estado limpo antes de começar: sem isto o resultado depende do que já estava
# rodando na máquina, que é o oposto de uma verificação reproduzível.
passo "encerrando servidores remanescentes"
encerrar_servidores
for porta in 3000 4000 4001 4002 4003; do
	aguardar_porta_livre "$porta" || printf '  \033[0;33m!\033[0m porta %s ainda ocupada\n' "$porta"
done

# =============================================================================
titulo "1 · Subida do zero"
# =============================================================================
# O cenário mais importante e o menos exercitado no dia a dia: o projeto sobe
# numa máquina limpa? Derrubar com `-v` apaga o volume, então migrations e seed
# rodam de fato, e não contra um banco que já estava pronto.

passo "derrubando containers e volumes"
docker compose down -v >/dev/null 2>&1

passo "subindo Postgres"
docker compose up -d postgres >/dev/null 2>&1

# Espera o **healthcheck do compose**, não um `pg_isready` solto.
#
# A imagem oficial sobe um servidor temporário para rodar a inicialização e só
# então reinicia o definitivo. `pg_isready` responde verdadeiro nessa janela, e
# quem confia nele conecta no servidor temporário: as migrations parecem passar,
# e o `select` seguinte falha com "relation does not exist". Foi exatamente essa
# corrida que fez uma execução inteira cascatear a partir do login.
prazo=$((SECONDS + 120))
until [ "$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null)" = "healthy" ]; do
	if [ $SECONDS -ge $prazo ]; then break; fi
	sleep 2
done

if [ "$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null)" = "healthy" ]; then
	ok "Postgres saudável (healthcheck do compose)"
else
	falha "Postgres não ficou saudável em 120s"
fi

passo "aplicando migrations em banco vazio"
if pnpm --silent --filter @saude-bliss/database db:migrate >/tmp/verify-migrate.log 2>&1; then
	ok "migrations aplicadas"
else
	falha "migrations falharam — ver /tmp/verify-migrate.log"
fi

passo "verificando as tabelas criadas"
TABELAS=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc \
	"select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'" 2>/dev/null)
for t in requests request_events users refresh_tokens; do
	verificar_contem "$t" "$TABELAS" "tabela $t criada"
done

passo "verificando os índices dos filtros"
INDICES=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc \
	"select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename='requests'" 2>/dev/null)
for i in idx_requests_created_by_created_at idx_requests_status_created_at idx_requests_created_trace_id; do
	verificar_contem "$i" "$INDICES" "índice $i"
done

passo "executando o seed"
if pnpm --silent --filter @saude-bliss/database db:seed >/tmp/verify-seed.log 2>&1; then
	USUARIOS=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc "select count(*) from users" 2>/dev/null | tr -d ' ')
	SOLICITACOES=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc "select count(*) from requests" 2>/dev/null | tr -d ' ')
	verificar 5 "$USUARIOS" "usuários semeados"
	verificar 8 "$SOLICITACOES" "solicitações semeadas"
else
	falha "seed falhou — ver /tmp/verify-seed.log"
fi

passo "seed é idempotente (roda duas vezes sem duplicar)"
pnpm --silent --filter @saude-bliss/database db:seed >/dev/null 2>&1
DEPOIS=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc "select count(*) from users" 2>/dev/null | tr -d ' ')
verificar 5 "$DEPOIS" "usuários após segundo seed"

passo "senha do seed é hash scrypt, nunca texto"
HASH=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc \
	"select password_hash from users limit 1" 2>/dev/null)
verificar_contem "scrypt\$32768\$8\$1\$" "$HASH" "hash no formato scrypt com parâmetros embutidos"
case "$HASH" in
*saudebliss123*) falha "a senha em texto vazou para o hash" ;;
*) ok "senha em texto não aparece no hash" ;;
esac

# =============================================================================
titulo "2 · Microserviços isolados"
# =============================================================================
# Como cada um roda em produção: uma Lambda por domínio, atendendo só o próprio
# prefixo. É o cenário que o modo agregado **não** cobre.

declare -a SERVICOS=("bliss-auth:4003:auth" "bliss-requests:4001:requests" "bliss-reviews:4002:reviews")

for entrada in "${SERVICOS[@]}"; do
	IFS=: read -r SERVICO PORTA PREFIXO <<<"$entrada"

	passo "subindo $SERVICO isolado na porta $PORTA"
	(cd "apps/api/functions/$SERVICO" && pnpm dev >"/tmp/verify-$SERVICO.log" 2>&1 &)

	if aguardar "http://localhost:$PORTA/v1/$PREFIXO/health" 60; then
		ok "$SERVICO no ar"

		SAUDE=$(json "http://localhost:$PORTA/v1/$PREFIXO/health")
		verificar_contem "\"service\":\"$SERVICO\"" "$SAUDE" "$SERVICO identifica a si mesmo no health"
		verificar_contem '"dependencies":"up"' "$SAUDE" "$SERVICO alcança o banco"

		# Swagger próprio: prova que o serviço isolado documenta só o que expõe.
		DOCS=$(json "http://localhost:$PORTA/docs/json")
		verificar_contem "bliss" "$DOCS" "$SERVICO expõe o próprio Swagger"

		# Isolamento: o serviço não pode atender o prefixo de outro domínio.
		for outro in auth requests reviews; do
			[ "$outro" = "$PREFIXO" ] && continue
			CODIGO=$(http "http://localhost:$PORTA/v1/$outro/health")
			verificar 404 "$CODIGO" "$SERVICO recusa /v1/$outro (domínio alheio)"
		done
	else
		falha "$SERVICO não subiu — ver /tmp/verify-$SERVICO.log"
	fi

	pkill -f "functions/$SERVICO" 2>/dev/null || true
	pkill -f "ts-node-dev.*run.local" 2>/dev/null || true
	sleep 2
done

# =============================================================================
titulo "3 · Modo agregado"
# =============================================================================
# Todos os domínios em um processo. Precisa expor **os mesmos caminhos** que as
# Lambdas isoladas — senão o desenvolvimento local deixa de reproduzir produção.

passo "subindo a API agregada na porta 4000"
(cd apps/api && pnpm dev >/tmp/verify-agregado.log 2>&1 &)

if aguardar "http://localhost:4000/v1/health" 90; then
	ok "API agregada no ar"

	AGREGADO=$(json "http://localhost:4000/v1/health")
	verificar_contem '"mode":"aggregated"' "$AGREGADO" "health agregado identifica o modo"

	# Os mesmos health por domínio que as Lambdas isoladas expõem.
	for dominio in auth requests reviews; do
		CODIGO=$(http "http://localhost:4000/v1/$dominio/health")
		verificar 200 "$CODIGO" "/v1/$dominio/health respondendo no agregado"
	done

	ROTAS=$(json "http://localhost:4000/docs/json" | python3 -c 'import sys,json;print(",".join(sorted(json.load(sys.stdin)["paths"])))' 2>/dev/null)
	for r in /v1/auth/login /v1/requests /v1/requests/{id} /v1/reviews/{id} /v1/reviews/{id}/timeline; do
		verificar_contem "$r" "$ROTAS" "rota $r documentada"
	done
else
	falha "API agregada não subiu — ver /tmp/verify-agregado.log"
fi

API="http://localhost:4000/v1"

# =============================================================================
titulo "4 · Autenticação real"
# =============================================================================
# Contra o banco, com a senha do seed — não com token forjado.

passo "login com credencial correta"
SESSAO=$(json -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"daniel.morais@saudebliss.test","password":"saudebliss123"}')

TOKEN=$(printf '%s' "$SESSAO" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])' 2>/dev/null || echo "")
REFRESH=$(printf '%s' "$SESSAO" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["refreshToken"])' 2>/dev/null || echo "")

if [ -n "$TOKEN" ]; then
	ok "login emitiu access token"
	verificar_contem '"tokenType":"Bearer"' "$SESSAO" "tipo do token"
	verificar_contem '"roles":["admin","reviewer"]' "$SESSAO" "papéis do usuário"
	# O JWT tem três segmentos; um token opaco teria um.
	SEGMENTOS=$(printf '%s' "$TOKEN" | awk -F. '{print NF}')
	verificar 3 "$SEGMENTOS" "access token é um JWT"
	# O refresh **não** é JWT: precisa ser revogável.
	SEG_REFRESH=$(printf '%s' "$REFRESH" | awk -F. '{print NF}')
	verificar 1 "$SEG_REFRESH" "refresh token é opaco, não JWT"
else
	falha "login não emitiu token: $SESSAO"
fi

passo "resposta indistinguível entre senha errada e e-mail inexistente"
ERRO_SENHA=$(json -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"daniel.morais@saudebliss.test","password":"senha-errada-1"}')
ERRO_EMAIL=$(json -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"nao-existe@saudebliss.test","password":"qualquer-senha"}')

CODIGO_SENHA=$(printf '%s' "$ERRO_SENHA" | python3 -c 'import sys,json;print(json.load(sys.stdin)["error"]["code"])' 2>/dev/null)
CODIGO_EMAIL=$(printf '%s' "$ERRO_EMAIL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["error"]["code"])' 2>/dev/null)
verificar "INVALID_CREDENTIALS" "$CODIGO_SENHA" "senha errada"
verificar "INVALID_CREDENTIALS" "$CODIGO_EMAIL" "e-mail inexistente"
verificar "$CODIGO_SENHA" "$CODIGO_EMAIL" "os dois casos são indistinguíveis"

passo "conta desativada responde 403, e só após a senha conferir"
CODIGO=$(http -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"inativo@saudebliss.test","password":"saudebliss123"}')
verificar 403 "$CODIGO" "usuário desativado com senha correta"

CODIGO=$(http -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"inativo@saudebliss.test","password":"senha-errada-1"}')
verificar 401 "$CODIGO" "usuário desativado com senha errada (não revela o status)"

passo "identidade a partir do token"
ME=$(json "$API/auth/me" -H "Authorization: Bearer $TOKEN")
verificar_contem "daniel.morais@saudebliss.test" "$ME" "GET /auth/me devolve o usuário"

passo "refresh rotaciona o token"
NOVA=$(json -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
NOVO_REFRESH=$(printf '%s' "$NOVA" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["refreshToken"])' 2>/dev/null || echo "")
if [ -n "$NOVO_REFRESH" ] && [ "$NOVO_REFRESH" != "$REFRESH" ]; then
	ok "refresh emitiu um token novo e diferente"
else
	falha "refresh não rotacionou o token"
fi

passo "reuso de token revogado derruba a família de sessões"
CODIGO=$(http -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
verificar 401 "$CODIGO" "token antigo recusado"
CODIGO=$(http -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$NOVO_REFRESH\"}")
verificar 401 "$CODIGO" "token novo também caiu (detecção de reuso)"

passo "logout revoga a sessão e é idempotente"
SESSAO2=$(json -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"daniel.morais@saudebliss.test","password":"saudebliss123"}')
REFRESH2=$(printf '%s' "$SESSAO2" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["refreshToken"])' 2>/dev/null || echo "")
TOKEN=$(printf '%s' "$SESSAO2" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])' 2>/dev/null || echo "")

CODIGO=$(http -X POST "$API/auth/logout" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH2\"}")
verificar 200 "$CODIGO" "logout"
CODIGO=$(http -X POST "$API/auth/logout" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH2\"}")
verificar 200 "$CODIGO" "logout repetido (idempotente)"
CODIGO=$(http -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH2\"}")
verificar 401 "$CODIGO" "refresh após logout"

passo "refresh token é guardado com hash, nunca em claro"
EM_CLARO=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc \
	"select count(*) from refresh_tokens where token_hash = '$REFRESH2'" 2>/dev/null | tr -d ' ')
verificar 0 "$EM_CLARO" "o token não está armazenado em texto"

# =============================================================================
titulo "5 · Fluxo completo de negócio"
# =============================================================================

SESSAO3=$(json -X POST "$API/auth/login" -H 'Content-Type: application/json' \
	-d '{"email":"daniel.morais@saudebliss.test","password":"saudebliss123"}')
TOKEN=$(printf '%s' "$SESSAO3" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])' 2>/dev/null || echo "")
AUTH=(-H "Authorization: Bearer $TOKEN")
TRACE="verify-$(date +%s)"

passo "criação com rastreabilidade"
CRIADA=$(json -X POST "$API/requests" "${AUTH[@]}" -H 'Content-Type: application/json' -H "x-request-id: $TRACE" \
	-d '{"title":"Verificação ponta a ponta","description":"Solicitação criada pelo verificador para exercitar o ciclo completo.","priority":"critical","createdBy":"Verificador@SaudeBliss.test"}')

ID=$(printf '%s' "$CRIADA" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null || echo "")
verificar_contem "\"requestId\":\"$TRACE\"" "$CRIADA" "requestId ecoado no envelope"
verificar_contem "\"createdTraceId\":\"$TRACE\"" "$CRIADA" "requestId persistido na linha"
verificar_contem '"status":"open"' "$CRIADA" "nasce em open"
verificar_contem '"createdBy":"verificador@saudebliss.test"' "$CRIADA" "createdBy normalizado para minúsculas"

passo "header x-request-id na resposta"
HEADER=$(curl -s -D - -o /dev/null --max-time 20 -X POST "$API/requests" "${AUTH[@]}" \
	-H 'Content-Type: application/json' -H "x-request-id: $TRACE-header" \
	-d '{"title":"Verificação de header","description":"Solicitação para conferir o header de correlação na resposta.","priority":"low","createdBy":"verificador@saudebliss.test"}' |
	grep -i '^x-request-id:' | tr -d '\r' | awk '{print $2}')
verificar "$TRACE-header" "$HEADER" "header x-request-id"

passo "validações de entrada"
verificar 400 "$(http -X POST "$API/requests" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"title":"ab","description":"curta","priority":"urgente","createdBy":"nao-email"}')" "payload inválido"
# Payload em arquivo: JSON com aspas escapadas dentro de `$(...)` embaralha a
# passagem de argumentos para `verificar`, e o diagnóstico sai ilegível.
cat >/tmp/verify-status-forcado.json <<'JSON'
{"title":"Tentativa de forçar status","description":"Descrição suficientemente longa para passar na validação.","priority":"low","createdBy":"x@y.test","status":"reviewed"}
JSON
verificar 400 "$(http -X POST "$API/requests" "${AUTH[@]}" -H 'Content-Type: application/json' --data @/tmp/verify-status-forcado.json)" "status no payload é recusado"
verificar 400 "$(http "$API/requests/nao-e-uuid" "${AUTH[@]}")" "id malformado"
verificar 404 "$(http "$API/requests/00000000-0000-4000-8000-999999999999" "${AUTH[@]}")" "uuid inexistente"
verificar 400 "$(http -G "$API/requests" "${AUTH[@]}" --data-urlencode 'status=arquivado')" "status fora do enum"
verificar 400 "$(http -G "$API/requests" "${AUTH[@]}" --data-urlencode 'pageSize=100000')" "pageSize acima do teto"

passo "filtros de listagem"
TOTAL_TODOS=$(json -G "$API/requests" "${AUTH[@]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["pagination"]["total"])' 2>/dev/null)
TOTAL_FILTRO=$(json -G "$API/requests" "${AUTH[@]}" --data-urlencode 'createdBy=verificador@saudebliss.test' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["pagination"]["total"])' 2>/dev/null)
TOTAL_COMBINADO=$(json -G "$API/requests" "${AUTH[@]}" --data-urlencode 'createdBy=verificador@saudebliss.test' --data-urlencode 'status=open' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["pagination"]["total"])' 2>/dev/null)

if [ "${TOTAL_FILTRO:-0}" -ge 2 ] && [ "${TOTAL_FILTRO:-0}" -lt "${TOTAL_TODOS:-0}" ]; then
	ok "filtro por createdBy restringe ($TOTAL_FILTRO de $TOTAL_TODOS)"
else
	falha "filtro por createdBy: $TOTAL_FILTRO de $TOTAL_TODOS"
fi
verificar "$TOTAL_FILTRO" "$TOTAL_COMBINADO" "filtros combinados (todas abertas)"

passo "paginação"
PAGINA=$(json -G "$API/requests" "${AUTH[@]}" --data-urlencode 'pageSize=2' --data-urlencode 'page=1')
verificar_contem '"pageSize":2' "$PAGINA" "pageSize respeitado"
ITENS=$(printf '%s' "$PAGINA" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]["items"]))' 2>/dev/null)
verificar 2 "$ITENS" "itens na página"

passo "conferência (outro microserviço)"
verificar 200 "$(http -X PATCH "$API/reviews/$ID" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"reviewedBy":"daniel.morais@saudebliss.test","status":"reviewed"}')" "PATCH /reviews/{id}"
verificar 409 "$(http -X PATCH "$API/reviews/$ID" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"reviewedBy":"outro@saudebliss.test","status":"reviewed"}')" "segunda conferência recusada"

TIMELINE=$(json "$API/reviews/$ID/timeline" "${AUTH[@]}")
EVENTOS=$(printf '%s' "$TIMELINE" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]["events"]))' 2>/dev/null)
verificar 2 "$EVENTOS" "trilha com criação e conferência"
verificar_contem "\"traceId\":\"$TRACE\"" "$TIMELINE" "evento de criação carrega o trace original"

passo "conferência concorrente elege uma vencedora"
NOVA_ID=$(json -X POST "$API/requests" "${AUTH[@]}" -H 'Content-Type: application/json' \
	-d '{"title":"Disputa de conferência","description":"Solicitação para verificar o compare-and-set sob concorrência.","priority":"high","createdBy":"verificador@saudebliss.test"}' |
	python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)

C1=$(http -X PATCH "$API/reviews/$NOVA_ID" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"reviewedBy":"a@saudebliss.test","status":"reviewed"}') &
P1=$!
C2=$(http -X PATCH "$API/reviews/$NOVA_ID" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"reviewedBy":"b@saudebliss.test","status":"rejected"}') &
P2=$!
wait $P1 $P2 2>/dev/null
EVENTOS_DISPUTA=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-saudebliss}" -d "${POSTGRES_DB:-saudebliss}" -tAc \
	"select count(*) from request_events where request_id='$NOVA_ID' and type='reviewed'" 2>/dev/null | tr -d ' ')
verificar 1 "$EVENTOS_DISPUTA" "exatamente um evento de conferência após a disputa"

passo "logs estruturados correlacionáveis"
# A leitura é do log do processo que este script iniciou. Se ele não subiu — por
# porta ocupada, por exemplo — a contagem seria de outro processo, e o resultado
# não diria nada sobre o código atual.
if grep -q "EADDRINUSE" /tmp/verify-agregado.log 2>/dev/null; then
	falha "a API agregada não subiu (porta ocupada) — a correlação mediria outro processo"
fi
LINHAS=$(grep -c "\"requestId\":\"$TRACE\"" /tmp/verify-agregado.log 2>/dev/null | head -1)
LINHAS=${LINHAS:-0}
if [ "${LINHAS:-0}" -ge 3 ]; then
	ok "$LINHAS linhas de log com o mesmo requestId (controller, service, repository)"
else
	falha "esperava ao menos 3 linhas correlacionadas, encontrou $LINHAS"
fi

# =============================================================================
titulo "6 · Backoffice"
# =============================================================================

passo "subindo o backoffice na porta 3000"
(cd apps/web && pnpm dev >/tmp/verify-web.log 2>&1 &)

if aguardar "http://localhost:3000/login" 120; then
	ok "backoffice no ar"

	# O `next dev` compila cada rota na primeira requisição, e até terminar
	# responde com um redirecionamento ou um shell sem o conteúdo. Aquecer antes
	# de afirmar evita medir o compilador em vez da aplicação.
	for rota in login solicitacoes conferencia; do
		curl -s -o /dev/null --max-time 60 "http://localhost:3000/$rota" || true
	done

	verificar 200 "$(http http://localhost:3000/login)" "tela de login"
	verificar 200 "$(http http://localhost:3000/solicitacoes)" "tela de solicitações"
	verificar 200 "$(http http://localhost:3000/conferencia)" "tela de conferência"

	# `data-testid` estável é o contrato com a automação: sem eles a suíte
	# Playwright não tem alvo determinístico.
	LOGIN_HTML=$(curl -s --max-time 20 http://localhost:3000/login)
	for t in login-form login-email login-password login-submit; do
		verificar_contem "data-testid=\"$t\"" "$LOGIN_HTML" "seletor $t presente"
	done
else
	falha "backoffice não subiu — ver /tmp/verify-web.log"
fi

passo "suíte Playwright do fluxo completo"
if (cd apps/automation && npx playwright test --project=chromium-headless >/tmp/verify-e2e.log 2>&1); then
	CENARIOS=$(grep -oE "[0-9]+ passed" /tmp/verify-e2e.log | head -1)
	ok "Playwright: $CENARIOS"
	if ls apps/automation/reports/conferencia-*.csv >/dev/null 2>&1; then
		LINHAS_CSV=$(($(wc -l <"$(ls -t apps/automation/reports/conferencia-*.csv | head -1)") - 1))
		if [ "$LINHAS_CSV" -gt 0 ]; then ok "relatório CSV com $LINHAS_CSV linha(s)"; else falha "CSV sem linhas"; fi
	else
		falha "CSV não gerado"
	fi
else
	falha "Playwright falhou — ver /tmp/verify-e2e.log"
fi

# =============================================================================
titulo "7 · Deploy no LocalStack"
# =============================================================================

if [ "$RAPIDO" = "1" ]; then
	passo "pulado (--rapido)"
else
	passo "subindo LocalStack"
	docker compose up -d localstack >/dev/null 2>&1

	if aguardar "http://localhost:${LOCALSTACK_PORT:-4568}/_localstack/health" 120; then
		ok "LocalStack no ar"

		passo "deploy completo (build → terraform → migrations → smoke)"
		if ./scripts/localstack/deploy.sh >/tmp/verify-deploy.log 2>&1; then
			ok "deploy concluído"

			URL=$(terraform -chdir=infra/terraform output -raw api_base_url 2>/dev/null)
			[ -n "$URL" ] && ok "URL da API: $URL" || falha "sem URL de saída"

			for dominio in auth requests reviews; do
				verificar 200 "$(http "$URL/$dominio/health")" "health de $dominio na API implantada"
			done

			LAMBDAS=$(terraform -chdir=infra/terraform output -json lambda_functions 2>/dev/null | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
			verificar 4 "$LAMBDAS" "quatro Lambdas provisionadas"

			passo "authorizer configurado no API Gateway"
			API_ID=$(terraform -chdir=infra/terraform output -raw api_id 2>/dev/null)
			AUTORIZADORES=$(./scripts/localstack/aws.sh apigateway get-authorizers --rest-api-id "$API_ID" --query 'length(items)' --output text 2>/dev/null)
			verificar 1 "$AUTORIZADORES" "authorizer criado"

			if ./scripts/localstack/verify-authorizer.sh >/tmp/verify-authz.log 2>&1; then
				ok "authorizer valida token e recusa forjado"
			else
				falha "verificação do authorizer falhou — ver /tmp/verify-authz.log"
			fi
		else
			falha "deploy falhou — ver /tmp/verify-deploy.log"
		fi
	else
		falha "LocalStack não subiu"
	fi
fi

# =============================================================================
titulo "Resultado"
# =============================================================================

printf '\n  \033[0;32m%d passaram\033[0m · \033[0;31m%d falharam\033[0m\n\n' "$PASSOU" "$FALHOU"

if [ "$FALHOU" -gt 0 ]; then
	printf '  Falhas:\n'
	for f in "${FALHAS[@]}"; do printf '    \033[0;31m✗\033[0m %s\n' "$f"; done
	echo
	exit 1
fi

printf '  \033[0;32mTodos os cenários verificados.\033[0m\n\n'
