# Saúde Bliss — Gestão de Solicitações

[![testes](https://img.shields.io/badge/testes-307%20passando-brightgreen)](#-testes)
[![e2e](https://img.shields.io/badge/playwright-19%20cenários-brightgreen)](#-automação-da-conferência)
[![stack](https://img.shields.io/badge/stack-Node%2022%20·%20TypeScript%20·%20Fastify-blue)](#-stack)
[![iac](https://img.shields.io/badge/iac-Terraform%20·%20Serverless%20Framework-844fba)](#-deploy)

Etapa técnica: **API serverless de gestão de solicitações** e **automação da
conferência operacional** com Playwright — mais um backoffice que fecha o ciclo.

---

## Índice

- [O que foi entregue](#-o-que-foi-entregue)
- [Arquitetura](#-arquitetura)
- [Stack](#-stack)
- [Início rápido](#-início-rápido)
- [Endpoints](#-endpoints)
- [Rastreabilidade por requestId](#-rastreabilidade-por-requestid)
- [Deploy](#-deploy)
- [Testes](#-testes)
- [Automação da conferência](#-automação-da-conferência)
- [Por que RDS](#-por-que-rds)
- [Decisões e limitações](#-decisões-e-limitações)

---

## 🎯 O que foi entregue

| Requisito do desafio                                 | Onde                                                |
| ---------------------------------------------------- | --------------------------------------------------- |
| Node.js + TypeScript + Serverless Framework          | `apps/api/functions/*/serverless.yml`               |
| Deploy em API Gateway + Lambda                       | `infra/terraform/` + `scripts/localstack/deploy.sh` |
| Persistência em RDS, com justificativa               | [ADR 0004](docs/adr/0004-rds-e-pool-de-conexoes.md) |
| Logs no CloudWatch e rastreabilidade por `requestId` | [ADR 0003](docs/adr/0003-requestid-traceability.md) |
| `POST /requests` com validação, retornando 201       | `bliss-requests`                                    |
| `GET /requests/{id}` com 404                         | `bliss-requests`                                    |
| `GET /requests?createdBy=&status=`                   | `bliss-requests`                                    |
| Separação handler/service/repository                 | todos os microserviços                              |
| Automação Playwright com Page Objects                | `apps/automation/`                                  |
| Headless e com UI, retries, trace, relatório         | `playwright.config.ts`                              |

**Além do pedido:** autenticação e autorização (`bliss-auth` + `bliss-authorizer`),
trilha de auditoria, e um backoffice Next.js — que é o sistema que a automação opera.

---

## 🏗️ Arquitetura

```
                            ┌──────────────────┐
   browser ──── x-request-id│   API Gateway    │
                            └────────┬─────────┘
                                     │  ┌─────────────────────┐
                          authorizer └──│  bliss-authorizer   │ valida o token
                                        └─────────────────────┘
                    ┌────────────────────┼────────────────────┐
              /v1/auth              /v1/requests          /v1/reviews
                    │                    │                    │
            ┌───────▼──────┐    ┌────────▼───────┐    ┌───────▼───────┐
            │  bliss-auth  │    │ bliss-requests │    │ bliss-reviews │
            │   (Lambda)   │    │    (Lambda)    │    │   (Lambda)    │
            └───────┬──────┘    └────────┬───────┘    └───────┬───────┘
                    └────────────────────┼────────────────────┘
                                ┌────────▼────────┐
                                │  RDS PostgreSQL │
                                └─────────────────┘
```

**Um microserviço por domínio, uma Lambda por microserviço.** Tudo que é
compartilhado vive fora deles, em `packages/`:

```
saude-bliss/
├── packages/
│   ├── contracts/    enums, schemas Zod, envelope — fonte única da verdade
│   ├── core/         factory de app, logging, erros, contexto, config, AWS
│   ├── database/     schema Drizzle, pool, migrations, seed, mappers
│   └── testing/      factories e duplos das suítes
├── apps/
│   ├── api/functions/{bliss-auth,bliss-authorizer,bliss-requests,bliss-reviews}
│   ├── web/          backoffice Next.js
│   └── automation/   suíte Playwright
├── infra/terraform/  módulos base + um módulo por serviço
└── docs/             ADRs, padrões, evidências
```

Cada microserviço segue a mesma estrutura em camadas:

```
src/
├── service.ts       defineService(...) — nome, prefixo, rotas, sonda de saúde
├── app.ts           createApp(service) + createLambdaHandler
├── router/          SOMENTE a tabela de rotas
├── controllers/     orquestração fina — sem regra de negócio
├── middlewares/     schemas Zod e validação de entrada
├── services/        regras de domínio
└── repositories/    acesso a dados — único lugar que importa `db`
```

Detalhes em [`CLAUDE.md`](CLAUDE.md) e [ADR 0001](docs/adr/0001-microservicos-por-dominio.md).

---

## 🧰 Stack

| Camada    | Escolha                             | Por quê                                                                                       |
| --------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Runtime   | Node 22, TypeScript `strict`        | greenfield, sem dívida a acomodar                                                             |
| HTTP      | Fastify 5 + `@fastify/aws-lambda`   | padrão da casa; schema por rota                                                               |
| Validação | Zod + `zod-to-json-schema`          | um schema alimenta validação e Swagger                                                        |
| Banco     | PostgreSQL + Drizzle ORM            | SQL-first, bundle mínimo em Lambda                                                            |
| Build     | esbuild → `function.zip`            | Terraform e `sls` consomem o mesmo artefato                                                   |
| IaC       | Terraform                           | única coisa que cria recurso — [ADR 0002](docs/adr/0002-serverless-framework-vs-terraform.md) |
| Emulação  | Serverless Framework 3 + LocalStack | v4 exigiria conta e travaria o deploy offline                                                 |
| Auth      | JWT HS256 (`jose`) + `scrypt`       | [ADR 0005](docs/adr/0005-autenticacao-e-autorizacao.md)                                       |
| Frontend  | Next.js 16 App Router + Tailwind 4  | padrão da casa                                                                                |
| E2E       | Playwright                          | Page Objects, oráculo de API, relatório CSV                                                   |

---

## 🚀 Início rápido

**Pré-requisitos:** Node 22, pnpm 10, Docker, Terraform ≥ 1.5.

```bash
git clone <repo> && cd saude-bliss
cp .env.example .env
pnpm install
```

### Opção A — desenvolvimento local (mais rápido)

Sobe os quatro domínios em um processo, contra o Postgres do compose.

```bash
docker compose up -d postgres
pnpm --filter @saude-bliss/database db:migrate
pnpm --filter @saude-bliss/database db:seed

pnpm --filter @saude-bliss/api dev      # API agregada  → :4000
pnpm --filter @saude-bliss/web dev      # backoffice    → :3000
```

|            |                                                   |
| ---------- | ------------------------------------------------- |
| API        | http://localhost:4000/v1                          |
| Swagger    | http://localhost:4000/docs                        |
| Backoffice | http://localhost:3000                             |
| Login      | `daniel.morais@saudebliss.test` / `saudebliss123` |

Para rodar um domínio **isolado**, como ele roda em produção:

```bash
pnpm --filter @saude-bliss/bliss-requests dev   # só /v1/requests → :4001
pnpm --filter @saude-bliss/bliss-reviews  dev   # só /v1/reviews  → :4002
```

### Opção B — deploy completo no LocalStack

API Gateway + Lambda + IAM + Secrets Manager + CloudWatch, provisionados por
Terraform. **Não precisa de licença** — ver [Deploy](#-deploy).

```bash
pnpm deploy:local
```

---

## 📡 Endpoints

Base: `{API_BASE_URL}` = `http://localhost:4000/v1` em desenvolvimento.

### Solicitações — `bliss-requests`

```bash
# Criar (201)
curl -X POST "$API/requests" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'x-request-id: meu-trace-123' \
  -d '{
    "title": "Agendamento não confirmado após pagamento",
    "description": "Beneficiária concluiu o pagamento mas não recebeu a confirmação.",
    "priority": "high",
    "createdBy": "ana.souza@saudebliss.test"
  }'
```

```jsonc
// 201
{
	"success": true,
	"data": {
		"id": "3f04dd9e-…",
		"status": "open", // sempre `open` — nunca aceito no payload
		"createdTraceId": "meu-trace-123",
		"createdAt": "2026-07-31T…",
	},
	"message": "Solicitação criada com sucesso",
	"requestId": "meu-trace-123", // o mesmo id, de volta
	"timestamp": "2026-07-31T…",
}
```

```bash
# Consultar por id — 404 quando não existe, 400 quando o id não é UUID
curl "$API/requests/{id}" -H "Authorization: Bearer $TOKEN"

# Listar com filtros combináveis
curl -G "$API/requests" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'status=open' \
  --data-urlencode 'createdBy=ana.souza@saudebliss.test'
```

### Conferência — `bliss-reviews`

```bash
curl -X PATCH "$API/reviews/{id}" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"reviewedBy":"daniel.morais@saudebliss.test","status":"reviewed"}'

curl "$API/reviews/{id}/timeline" -H "Authorization: Bearer $TOKEN"
```

Conferir duas vezes devolve **409** — é um compare-and-set no `UPDATE`, então duas
pessoas conferindo a mesma linha resultam em uma vencedora, não em escrita perdida.

### Autenticação — `bliss-auth`

```bash
curl -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"daniel.morais@saudebliss.test","password":"saudebliss123"}'
```

`POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me`

### Envelope

Toda resposta, sem exceção:

```jsonc
{ "success": true,  "data": {…}, "message": "…", "requestId": "…", "timestamp": "…" }
{ "success": false, "error": { "code": "REQUEST_NOT_FOUND", "message": "…" }, "requestId": "…", "timestamp": "…" }
```

`GET /{domínio}/health` é **público** em todos os serviços — monitoração não deve
precisar de credencial.

---

## 🔍 Rastreabilidade por requestId

Um único id atravessa **browser → API Gateway → Lambda → banco → CloudWatch**.

```bash
curl -X POST "$API/requests" -H 'x-request-id: evidencia-001' …
```

```
# nas linhas de log
debug RequestsController   create  criando solicitação      requestId=evidencia-001
debug RequestsService      create  criando solicitação      requestId=evidencia-001
debug RequestsRepository   insert  inserindo solicitação    requestId=evidencia-001
info  RequestsRepository   insert  solicitação inserida     requestId=evidencia-001
info  RequestsService      create  solicitação criada       requestId=evidencia-001
info  RequestsController   create  solicitação criada       requestId=evidencia-001
```

```sql
-- e persistido na linha
select created_trace_id from requests where created_trace_id = 'evidencia-001';
-- evidencia-001
```

Cada linha de log é **um objeto JSON com `requestId` no nível raiz**, então o
CloudWatch Logs Insights consulta sem expressão de parse:

```
fields @timestamp, requestId, module, action, message, durationMs
| filter requestId = "evidencia-001"
| sort @timestamp asc
```

Mecanismo completo em [ADR 0003](docs/adr/0003-requestid-traceability.md).

---

## 📦 Deploy

**Terraform provisiona; Serverless Framework emula e empacota.** Os dois consomem o
mesmo `dist/function.zip`. Ver [ADR 0002](docs/adr/0002-serverless-framework-vs-terraform.md).

### LocalStack

```bash
pnpm deploy:local
```

O script executa, em ordem: aguarda a infraestrutura → empacota com esbuild →
**verifica paridade de rotas** → `terraform apply` → migrations e seed → smoke test.

O build vem antes do Terraform porque ele lê o zip por `filebase64sha256` — invertê-los
publica o artefato da execução anterior.

> **Sem licença.** O LocalStack está fixado na **v3**: as imagens `latest` de 2026
> exigem `LOCALSTACK_AUTH_TOKEN` mesmo para serviços gratuitos e abortam sem ele. A
> v3 cobre tudo que o projeto usa. O único recurso Pro é a emulação de RDS, e o
> Terraform já vem com `create_rds_instance = false`, apontando o segredo para o
> Postgres do compose.
>
> Com token: use `LOCALSTACK_IMAGE=localstack/localstack-pro:latest`, acrescente
> `rds` em `LOCALSTACK_SERVICES` e ligue `create_rds_instance = true`.

### AWS real

O **mesmo HCL**, uma flag diferente:

```bash
pnpm --filter './apps/api/functions/*' build:dev
terraform -chdir=infra/terraform apply -var-file=environments/dev.tfvars
```

`environments/dev.tfvars` difere de `local.tfvars` apenas em `use_localstack = false`.

### Verificação de paridade de rotas

```bash
pnpm --filter @saude-bliss/api check:routes
```

```
✓ bliss-requests: /requests (4 rotas)
    GET /
    GET /health
    GET /{id}
    POST /
✓ bliss-reviews: /reviews (3 rotas)
✓ bliss-auth: /auth (5 rotas)

✓ rotas em paridade entre o router, o Terraform e o serverless.yml
```

---

## 🧪 Testes

**307 testes** em quatro camadas, nomes em PT-BR descrevendo comportamento.

```bash
pnpm test                                        # todos os microserviços
pnpm --filter @saude-bliss/core test             # runtime compartilhado
pnpm --filter @saude-bliss/bliss-requests test:e2e   # contra Postgres real
```

| Camada        | O que exercita                                       |
| ------------- | ---------------------------------------------------- |
| `unit`        | tudo mockado, sem I/O                                |
| `integration` | `app.inject()`, repositório mockado                  |
| `contract`    | snapshot do `zodToJsonSchema` — pega drift front↔API |
| `e2e`         | Postgres real com migrations aplicadas               |

Duas suítes valem além da cobertura:

- **`traceability.integration.test.ts`** — afirma que um único `requestId` chega ao
  header, ao envelope, aos logs e à coluna persistida, inclusive em 400/404/500.
- **`reviews.e2e.test.ts`** — dispara duas conferências **concorrentes** da mesma
  solicitação e afirma que exatamente uma vence e exatamente um evento é gravado.
  É o compare-and-set no `where` do `UPDATE`; repositório mockado só pode supor.

**Cobertura:** 95%+ em statements, linhas e funções nas camadas de lógica. Branches
fica abaixo onde os ramos restantes são fallbacks defensivos sem caminho de negócio
que os atinja — forçar 95% ali produziria teste escrito para a métrica.

---

## 🤖 Automação da conferência

Automatiza o fluxo operacional diário: abrir a fila, conferir cada solicitação
contra o registro, marcar como revisada.

```bash
cd apps/automation
cp .env.example .env
pnpm install:browsers

pnpm test          # headless
pnpm test:headed   # com UI, em câmera lenta
pnpm test:ui       # modo interativo
pnpm report        # abre o relatório HTML
```

**19 cenários** — smoke, filtros, conferência diária, rastreabilidade e divergências.

### O que faz disso uma conferência

A suíte compara **campo a campo** o que a tela renderiza com o que a API devolve.
Sem essa comparação, os testes passariam com a tela exibindo dado errado.

```
src/
├── api/ApiClient.ts        o oráculo — e semeia os dados de cada teste
├── pages/                  Page Objects
├── fixtures/test.ts        autenticação + seed com createdBy por execução
└── reporters/CsvReporter.ts
```

Cada teste semeia sob um `createdBy` próprio e filtra por ele — é o que torna
retentativa segura e impede o resultado de ser função da ordem de execução.

### Saída

`reports/conferencia-AAAA-MM-DD.csv`:

```csv
runId,timestamp,requestId,solicitacaoId,title,createdBy,priority,statusUI,statusAPI,divergencia,acao,resultado,durationMs,teste
```

É um **Reporter**, não escrita dentro do teste: o arquivo sai mesmo quando a suíte
falha — que é precisamente quando a operação precisa saber o que divergiu.

Falhas geram trace, screenshot e vídeo (`test-results/`).

---

## 💾 Por que RDS

Argumentando pelo domínio, não por preferência:

- **Schema estável e fechado** — o desafio enumera os campos.
- **Filtros ad-hoc combináveis** (`?createdBy=&status=`) são caros de modelar em
  chave composta e triviais em SQL. Foi este o critério que decidiu.
- **Escrita transacional em duas tabelas** — mudança de status e evento de auditoria
  precisam acontecer juntas.
- **Integridade referencial** — a FK com cascade impede evento órfão.

**Contraponto honesto:** DynamoDB seria superior em escala de escrita imprevisível e
em custo ocioso, e dispensa VPC e gerenciamento de conexão. RDS traz um custo real:

```
max_connections >= reserved_concurrency × DB_POOL_MAX + folga
```

Com `DB_POOL_MAX = 1` e `reserved_concurrency = 10`, são 10 conexões contra as ~87
de uma `db.t4g.micro`. Detalhes em [ADR 0004](docs/adr/0004-rds-e-pool-de-conexoes.md).

---

## ⚖️ Decisões e limitações

| Decisão                              | Motivo                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Serverless Framework **e** Terraform | o desafio exige o primeiro, o padrão do time usa o segundo — ADR 0002         |
| `serverless@3`                       | a v4 exige conta e travaria o deploy offline                                  |
| LocalStack v3 fixado                 | as imagens de 2026 exigem token mesmo para serviços gratuitos                 |
| `PATCH /reviews/{id}` além do escopo | a automação precisa de ação de escrita para ser fluxo, não roteiro de cliques |
| `strict: true` no TypeScript         | desvio consciente do backend da casa (`strict: false`)                        |
| Zod 3 em vez de 4                    | `zod-to-json-schema` é Zod-3-only, e é o padrão da casa                       |

### Limitações conhecidas

**O LocalStack Community não executa custom authorizers.** A configuração está
correta — `aws apigateway get-method` devolve `authorizationType: CUSTOM` com o
`authorizerId` do authorizer criado — mas a emulação não chega a invocá-lo. O smoke
detecta se a borda aplica autorização e, quando não aplica, valida o authorizer por
invocação direta com o mesmo contrato de evento `REQUEST`.

**O deploy demonstrado é local.** O mesmo HCL sobe em AWS real com
`use_localstack = false`; não foi executado por não haver conta provisionada.

---

## 📚 Documentação

| Documento                                                      | Conteúdo                                     |
| -------------------------------------------------------------- | -------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                                       | padrões de código e fronteiras arquiteturais |
| [ADR 0001](docs/adr/0001-microservicos-por-dominio.md)         | microserviços por domínio                    |
| [ADR 0002](docs/adr/0002-serverless-framework-vs-terraform.md) | Serverless Framework e Terraform             |
| [ADR 0003](docs/adr/0003-requestid-traceability.md)            | rastreabilidade por `requestId`              |
| [ADR 0004](docs/adr/0004-rds-e-pool-de-conexoes.md)            | RDS e pool de conexões                       |
| [ADR 0005](docs/adr/0005-autenticacao-e-autorizacao.md)        | autenticação e autorização                   |
| [`docs/evidence/`](docs/evidence/)                             | evidências de execução                       |
