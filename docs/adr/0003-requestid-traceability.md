# ADR 0003 — Rastreabilidade por requestId

> Última atualização: 2026-07-31

**Status:** aceito

## Contexto

A operação precisa correlacionar uma requisição de ponta a ponta por um único
`requestId`. O modo de falha que isso previne é
sutil: cada camada gerar o próprio id, de forma que os logs parecem corretos até
alguém tentar correlacionar um incidente e descobrir que não dá.

## Decisão

Um único id atravessa a requisição inteira, com esta precedência:

1. Header `x-request-id` enviado pelo cliente
2. `event.requestContext.requestId` do API Gateway
3. `context.awsRequestId` da invocação

O cliente vence de propósito: é o que permite seguir um trace que começou no browser.

### Cadeia

| Onde                | Como                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| Fronteira Lambda    | `createLambdaHandler` normaliza o header e envolve tudo em `runWithRequestContext` |
| Fastify             | `genReqId` lê o header — `req.id` é o valor canônico                               |
| Contexto assíncrono | `AsyncLocalStorage`, via hook `onRequest`                                          |
| Logs                | `BlissLogger` lê do ALS; toda linha é um JSON com `requestId` no nível raiz        |
| Envelope            | campo `requestId` em toda resposta, sucesso ou erro                                |
| Header de resposta  | `x-request-id`                                                                     |
| Banco               | `requests.created_trace_id` e `request_events.trace_id`                            |
| Backoffice          | `RequestIdBadge` exibe o id; o interceptor o gera e envia                          |

### Por que `runWithRequestContext` **e** `enterWith`

`enterWith` no hook basta para a requisição, mas em container Lambda reutilizado
deixa o store da invocação anterior vivo para trabalho assíncrono pendente,
carimbando logs com o `requestId` errado. O handler envolve tudo em `als.run(...)`
para garantir a destruição entre invocações.

## Nomenclatura

A entidade se chama _request_ e o id de correlação também. Nomear a coluna
`requests.request_id` seria ambíguo e colidiria com a FK em `request_events`.

**Decisão:** `trace_id` na persistência, `requestId` no HTTP — que é o contrato da
casa e o nome que o cliente já usa no header.

## Verificação

`filter requestId = "..."` no CloudWatch Logs Insights funciona sem expressão de
parse, porque cada linha é um objeto JSON com o campo no topo. Evidência em
`docs/evidence/`.
