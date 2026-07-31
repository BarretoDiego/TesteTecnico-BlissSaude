# Evidência — automação da conferência

> Capturado em 2026-07-31T07:45:45Z

```

Running 19 tests using 1 worker

  ✓   1 [chromium-headless] › tests/conferencia/conferencia-diaria.spec.ts:17:6 › conferência diária › confere cada solicitação comparando a linha da UI com o registro da API (1.2s)
  ✓   2 [chromium-headless] › tests/conferencia/conferencia-diaria.spec.ts:67:6 › conferência diária › marca como revisada e a solicitação sai da fila (887ms)
  ✓   3 [chromium-headless] › tests/conferencia/conferencia-diaria.spec.ts:87:6 › conferência diária › a conferência é registrada na trilha de auditoria (818ms)
  ✓   4 [chromium-headless] › tests/conferencia/conferencia-diaria.spec.ts:105:6 › conferência diária › rejeita uma solicitação e ela deixa a fila com status rejected (836ms)
  ✓   5 [chromium-headless] › tests/conferencia/conferencia-diaria.spec.ts:120:6 › conferência diária › o contador da fila diminui a cada conferência (827ms)
  ✓   6 [chromium-headless] › tests/conferencia/divergencias.spec.ts:8:6 › divergências e erros › exibe estado de não encontrado para um id inexistente (612ms)
  ✓   7 [chromium-headless] › tests/conferencia/divergencias.spec.ts:14:6 › divergências e erros › registra divergência quando o status muda entre a leitura da tela e a da API (786ms)
  ✓   8 [chromium-headless] › tests/conferencia/divergencias.spec.ts:51:6 › divergências e erros › uma segunda conferência da mesma solicitação é recusada pela API (1.0s)
  ✓   9 [chromium-headless] › tests/conferencia/filtros.spec.ts:12:6 › filtros da listagem › filtra por solicitante e retorna somente as solicitações dele (658ms)
  ✓  10 [chromium-headless] › tests/conferencia/filtros.spec.ts:28:6 › filtros da listagem › filtra por status (677ms)
  ✓  11 [chromium-headless] › tests/conferencia/filtros.spec.ts:39:6 › filtros da listagem › combina os filtros de status e solicitante (649ms)
  ✓  12 [chromium-headless] › tests/conferencia/filtros.spec.ts:55:6 › filtros da listagem › exibe estado vazio quando o filtro não retorna resultados (566ms)
  ✓  13 [chromium-headless] › tests/conferencia/filtros.spec.ts:62:6 › filtros da listagem › o filtro sobrevive à recarga porque vive na URL (718ms)
  ✓  14 [chromium-headless] › tests/conferencia/rastreabilidade.spec.ts:9:6 › rastreabilidade › o requestId enviado na criação é persistido e exibido no detalhe (691ms)
  ✓  15 [chromium-headless] › tests/conferencia/rastreabilidade.spec.ts:36:6 › rastreabilidade › a tela de detalhe exibe a trilha com o trace de cada evento (692ms)
  ✓  16 [chromium-headless] › tests/smoke/health.spec.ts:11:6 › smoke › a API responde e devolve solicitações (62ms)
  ✓  17 [chromium-headless] › tests/smoke/health.spec.ts:17:6 › smoke › o backoffice carrega a tela de login (264ms)
  ✓  18 [chromium-headless] › tests/smoke/health.spec.ts:23:6 › smoke › autentica e chega ao backoffice (510ms)
  ✓  19 [chromium-headless] › tests/smoke/health.spec.ts:32:6 › smoke › recusa credencial inválida sem revelar qual campo errou (391ms)

  19 passed (13.5s)

  relatório de conferência: reports/conferencia-2026-07-31.csv (4 linha(s), status passed)
```

## Relatório CSV

Gerado por um `Reporter`, e não dentro do teste, para sair mesmo quando a
suíte falha — que é quando a operação precisa dele.

```csv
﻿runId,timestamp,requestId,solicitacaoId,title,createdBy,priority,statusUI,statusAPI,divergencia,acao,resultado,durationMs,teste
"256907fd","2026-07-31T07:45:47.402Z","","e0f0b932-6087-4dd1-b9d5-b3a4f8a09b2d","Conferência automatizada 256907fd #1","conferencia+256907fd@saudebliss.test","high","open","open","não","conferida","conforme","1237","confere cada solicitação comparando a linha da UI com o registro da API"
"256907fd","2026-07-31T07:45:47.402Z","","1734bdf8-b62d-4869-9148-56ba37a34a39","Conferência automatizada 256907fd #2","conferencia+256907fd@saudebliss.test","high","open","open","não","conferida","conforme","1237","confere cada solicitação comparando a linha da UI com o registro da API"
"256907fd","2026-07-31T07:45:47.402Z","","4e21b53a-843a-437e-b865-dfcb6bb098c3","Conferência automatizada 256907fd #3","conferencia+256907fd@saudebliss.test","high","open","open","não","conferida","conforme","1237","confere cada solicitação comparando a linha da UI com o registro da API"
"divergencia","2026-07-31T07:45:52.199Z","","78d5697e-faac-45c5-9bd1-376c5e32622d","Conferência automatizada 0fda7f53 #1","conferencia+0fda7f53@saudebliss.test","high","open","open","não","verificada","conforme","786","registra divergência quando o status muda entre a leitura da tela e a da API"
```
