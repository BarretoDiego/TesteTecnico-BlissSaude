# Saúde Bliss — Gestão de Solicitações

[![testes](https://img.shields.io/badge/testes-890%20passando-brightgreen)](#-testes)
[![e2e](https://img.shields.io/badge/playwright-21%20cenários-brightgreen)](#-automação-da-conferência)
[![stack](https://img.shields.io/badge/stack-Node%2022%20·%20TypeScript%20·%20Fastify-blue)](#-stack)
[![iac](https://img.shields.io/badge/iac-Terraform%20·%20Serverless%20Framework-844fba)](#-deploy)

**API serverless de gestão de solicitações** e **automação da conferência
operacional** com Playwright — mais um backoffice que fecha o ciclo.

---

## Índice

- [O que foi entregue](#-o-que-foi-entregue)
- [Arquitetura](#-arquitetura)
- [Stack](#-stack)
- [Início rápido](#-início-rápido)
- [Verificação](#-verificação)
- [Telas](#-telas)
- [Endpoints](#-endpoints)
- [Rastreabilidade por requestId](#-rastreabilidade-por-requestid)
- [Deploy](#-deploy)
- [Testes](#-testes)
- [Automação da conferência](#-automação-da-conferência)
- [Por que RDS](#-por-que-rds)
- [Decisões e limitações](#-decisões-e-limitações)

---

## 🎯 O que foi entregue

| Requisito                                            | Onde                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Node.js + TypeScript + Serverless Framework          | `apps/api/serverless.yml` — `pnpm deploy:sls`                                                          |
| Deploy em API Gateway + Lambda                       | duas trilhas — Terraform e Serverless ([ADR 0002](docs/adr/0002-serverless-framework-vs-terraform.md)) |
| Persistência em RDS, com justificativa               | [ADR 0004](docs/adr/0004-rds-e-pool-de-conexoes.md)                                                    |
| Logs no CloudWatch e rastreabilidade por `requestId` | [ADR 0003](docs/adr/0003-requestid-traceability.md)                                                    |
| `POST /requests` com validação, retornando 201       | `bliss-requests`                                                                                       |
| `GET /requests/{id}` com 404                         | `bliss-requests`                                                                                       |
| `GET /requests?createdBy=&status=`                   | `bliss-requests`                                                                                       |
| Separação handler/service/repository                 | todos os microserviços                                                                                 |
| Automação Playwright com Page Objects                | `apps/automation/`                                                                                     |
| Headless e com UI, retries, trace, relatório         | `playwright.config.ts`                                                                                 |

**Acrescentado ao escopo mínimo:** autenticação e autorização (`bliss-auth` +
`bliss-authorizer`), trilha de auditoria, e um backoffice Next.js — que é o sistema
que a automação opera.

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

| Camada    | Escolha                              | Por quê                                                                                                                |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Runtime   | Node 22, TypeScript `strict`         | greenfield, sem dívida a acomodar                                                                                      |
| HTTP      | Fastify 5 + `@fastify/aws-lambda`    | schema por rota, adaptador oficial para Lambda                                                                         |
| Validação | Zod + `zod-to-json-schema`           | um schema alimenta validação e Swagger                                                                                 |
| Banco     | PostgreSQL + Drizzle ORM             | SQL-first, bundle mínimo em Lambda                                                                                     |
| Build     | esbuild → `function.zip`             | Terraform e `sls` consomem o mesmo artefato                                                                            |
| IaC       | Terraform **e** Serverless Framework | duas trilhas de deploy completas, em stages separados — [ADR 0002](docs/adr/0002-serverless-framework-vs-terraform.md) |
| Emulação  | LocalStack v3                        | Serverless fixado na v3: a v4 exige conta e travaria o deploy offline                                                  |
| Auth      | JWT HS256 (`jose`) + `scrypt`        | [ADR 0005](docs/adr/0005-autenticacao-e-autorizacao.md)                                                                |
| Frontend  | Next.js 16 App Router + Tailwind 4   | Server Components e estado de filtro na URL                                                                            |
| E2E       | Playwright                           | Page Objects, oráculo de API, relatório CSV                                                                            |

---

## 🚀 Início rápido

**Pré-requisitos:** Node 22, pnpm 10, Docker, Terraform ≥ 1.5, AWS CLI.
No macOS: `brew install node pnpm terraform awscli` e o Docker Desktop ou OrbStack.

### Um comando

```bash
git clone <repo> && cd saude-bliss && pnpm install && pnpm start
```

`pnpm start` faz tudo em ordem — checa os pré-requisitos, cria o `.env`, sobe
LocalStack e Postgres, empacota os quatro microserviços, provisiona com Terraform,
aplica migrations e seed, roda o smoke test, sobe o backoffice e **imprime os
endereços no fim**. É idempotente: rodar de novo com tudo no ar reaproveita.

A ordem é o motivo de o script existir. O Terraform lê o zip pelo hash do
conteúdo, as migrations precisam da URL que o `apply` produziu, e o backoffice
precisa da URL do API Gateway antes de subir. Errar a sequência falha de formas
que não se parecem com a causa.

Ao final:

|                                     |                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| **Backoffice**                      | http://localhost:3000                                                         |
| **API (API Gateway do LocalStack)** | `pnpm urls` imprime — a URL carrega o id do REST API, que muda a cada `apply` |
| **Login**                           | `daniel.morais@saudebliss.test` / `saudebliss123`                             |

> **Sem licença do LocalStack.** A imagem está fixada na v3 e o Terraform já vem
> com `create_rds_instance = false`. Nada aqui exige token.

### A segunda trilha de deploy

`pnpm start` provisiona com **Terraform**. A trilha do **Serverless Framework** é
igualmente completa, sobe em outro stage e **coexiste** com a primeira — não é
preciso derrubar nada para experimentá-la:

```bash
pnpm deploy:sls      # build → serverless deploy → migrations → seed → smoke
pnpm urls            # imprime as duas URLs, lado a lado
pnpm deploy:sls:remove   # derruba só o stack do Serverless
```

Ela pressupõe a infraestrutura local no ar (o `pnpm start`, ou `pnpm infra:up`
sozinho). Diferenças, limitações do emulador e como escolher entre as duas estão
em [Deploy](#-deploy).

### Comandos

**Ciclo de vida**

| Comando         | O que faz                                   |
| --------------- | ------------------------------------------- |
| `pnpm start`    | do zero ao sistema no ar — trilha Terraform |
| `pnpm stop`     | derruba tudo, preservando os dados          |
| `pnpm reset`    | derruba, apaga os volumes e sobe do zero    |
| `pnpm infra:up` | só LocalStack e Postgres, sem deploy        |
| `pnpm urls`     | endereços, credenciais e telas              |

**Deploy**

| Comando                  | O que faz                                       |
| ------------------------ | ----------------------------------------------- |
| `pnpm deploy:local`      | build → Terraform → migrations → seed → smoke   |
| `pnpm deploy:sls`        | build → Serverless → migrations → seed → smoke  |
| `pnpm deploy:sls:remove` | derruba o stack do Serverless                   |
| `pnpm check:routes`      | paridade de rotas entre router, Terraform e sls |

**Verificar**

| Comando          | O que faz                                                    |
| ---------------- | ------------------------------------------------------------ |
| `pnpm smoke`     | 17 asserções contra a API implantada                         |
| `pnpm test`      | as oito suítes Jest — unidade, integração, contrato e e2e    |
| `pnpm test:e2e`  | suíte Playwright contra o sistema no ar                      |
| `pnpm typecheck` | tipos de todo o monorepo                                     |
| `pnpm verify`    | verificação ponta a ponta (ver [Verificação](#-verificação)) |

**Inspecionar**

| Comando                  | O que faz                                        |
| ------------------------ | ------------------------------------------------ |
| `pnpm resources`         | inventário do que existe na AWS local            |
| `pnpm logs`              | logs das Lambdas no CloudWatch                   |
| `pnpm logs --trace <id>` | uma requisição inteira, atravessando os serviços |
| `pnpm evidence`          | regenera `docs/evidence/`                        |

### Modo de desenvolvimento

Para iterar em código, sem passar por empacotamento e deploy a cada mudança:

```bash
pnpm infra:up          # só LocalStack e Postgres
pnpm db:migrate && pnpm db:seed
pnpm dev:api           # os quatro domínios num processo → :4000 (Swagger em /docs)
pnpm dev:web           # backoffice → :3000
```

Ou um domínio **isolado**, como ele roda em produção:

```bash
pnpm --filter @saude-bliss/bliss-requests dev   # só /v1/requests → :4001
pnpm --filter @saude-bliss/bliss-reviews  dev   # só /v1/reviews  → :4002
pnpm --filter @saude-bliss/bliss-auth     dev   # só /v1/auth     → :4003
```

---

## ✅ Verificação

Como confirmar que tudo funciona, do mais rápido ao mais completo. O mapa antes
do detalhe:

| Comando          | O que cobre                                    | Precisa de                       |
| ---------------- | ---------------------------------------------- | -------------------------------- |
| `pnpm typecheck` | tipos de todo o monorepo                       | nada                             |
| `pnpm test`      | unidade, integração, contrato e e2e das suítes | Postgres para a camada e2e¹      |
| `pnpm smoke`     | a API **implantada**, ponta a ponta            | um deploy no ar                  |
| `pnpm test:e2e`  | o sistema pelo browser, com Playwright         | sistema no ar + browsers²        |
| `pnpm verify`    | subida do zero, isolamento, auth real e deploy | Docker (derruba e sobe o volume) |

¹ `pnpm infra:up && pnpm db:migrate`. Sem banco a camada `e2e` falha — `SKIP_E2E=1` pula.
² `pnpm --filter @saude-bliss/automation install:browsers`, uma vez por máquina.

Quem quer só uma resposta de "está tudo de pé?": `pnpm start && pnpm verify:rapido`.

### 1. Pelo navegador

`pnpm urls` imprime os endereços. Entre com `daniel.morais@saudebliss.test` /
`saudebliss123`. Cada tela exercita rotas diferentes:

| Tela                 | Rotas que exercita                                 |
| -------------------- | -------------------------------------------------- |
| `/solicitacoes`      | `GET /requests` — filtros e paginação              |
| `/solicitacoes/nova` | `POST /requests` — validação e 201                 |
| `/solicitacoes/{id}` | `GET /requests/{id}`, `GET /reviews/{id}/timeline` |
| `/conferencia`       | `PATCH /reviews/{id}` — com confirmação            |
| `/status`            | os três `/health` e o `GET /auth/me`               |
| cabeçalho → seu nome | `GET /auth/me` no modal de perfil                  |

**As doze rotas publicadas são alcançáveis pela interface.** A de status existe
justamente para fechar as que nenhuma outra tela tocaria.

### 2. Rastreabilidade, ponta a ponta

O `requestId` que o cliente envia volta no envelope, no header, e atravessa todas
as camadas de log até a coluna no banco:

```bash
curl -s "$(pnpm -s urls | grep -o 'http://localhost:4568[^ ]*v1')/requests?status=open" \
  -H 'x-request-id: meu-teste'

pnpm logs --trace meu-teste
```

A segunda linha devolve a requisição inteira — controller, service e repositório —
com o mesmo id que você escolheu. Na tela, o mesmo valor aparece em **Trace da
criação** no detalhe da solicitação.

### 3. Smoke test

```bash
pnpm smoke
```

17 asserções contra a API implantada: os três endpoints de solicitações com 201/200/404,
payload inválido em 400, id malformado em 400, filtros, conferência, 409 na segunda
conferência, trilha de auditoria, e o `requestId` persistido.

### 4. Suítes automatizadas

```bash
pnpm test        # 890 testes — unidade, integração, contrato e e2e
pnpm test:e2e    # 21 cenários Playwright × headless e headed = 42 execuções
pnpm typecheck   # sem erros de tipo em todo o monorepo
```

`pnpm test` cobre as oito suítes do monorepo — quatro microserviços, três pacotes
compartilhados e o backoffice. Detalhe das camadas em [Testes](#-testes); a suíte
Playwright, em [Automação da conferência](#-automação-da-conferência).

### 5. Verificação operacional completa

```bash
pnpm verify           # tudo, incluindo o deploy do zero (~6 min)
pnpm verify:rapido    # pula o deploy (~2 min)
```

Cobre o que as suítes não alcançam: que o projeto **sobe do zero**, que cada
microserviço roda isolado, que o modo agregado se comporta igual, que a
autenticação funciona contra o banco de verdade, e que o deploy entrega uma API
utilizável. É o roteiro que alguém faria à mão — roteirizado para ser executado
inteiro, na mesma ordem, com resultado comparável entre execuções.

### 6. Recursos na AWS local

```bash
pnpm resources
```

Lambdas, API Gateway, rotas, **autorização por método**, log groups e segredos.
O LocalStack Community não tem console web — o painel do `app.localstack.cloud`
exige conta —, então este é o substituto. Qualquer comando da AWS CLI funciona
pelo wrapper:

```bash
./scripts/localstack/aws.sh lambda list-functions
```

O wrapper existe porque o LocalStack deste projeto sobe na porta **4568**, não na
4566 padrão: outra instância pode já estar rodando na máquina, e `awslocal`
acertaria a errada em silêncio.

---

## 🖥️ Telas

O backoffice não é vitrine: é o sistema que a automação do Playwright opera, e
cobre todas as rotas publicadas.

| Tela                 | O que faz                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Solicitações**     | listagem com filtros por status, prioridade e solicitante, e paginação com escolha de itens por página. Estado dos filtros e da página **na URL** — compartilhável, sobrevive à recarga, e a automação salta direto para um estado                     |
| **Nova solicitação** | abre a solicitação. Valida com o **mesmo** schema Zod da API, então as mensagens são idênticas dos dois lados; erros do servidor voltam para o campo. A confirmação mostra o `createdTraceId` — o `x-request-id` que o browser gerou, gravado no banco |
| **Detalhe**          | dados da solicitação e trilha de auditoria com rótulos em PT-BR, quem agiu, quando e o trace de cada evento. O botão **Recarregar trilha** usa `GET /reviews/{id}/timeline`, do outro microserviço                                                     |
| **Conferência**      | fila paginada dos pendentes. Revisar e rejeitar pedem **confirmação num modal** que nomeia a solicitação: a ação é irreversível e fica registrada em nome de quem confirmou                                                                            |
| **Status**           | saúde dos três microserviços em paralelo e a identidade da sessão. Diz _qual_ Lambda caiu, não só que "a API falhou"                                                                                                                                   |
| **Perfil**           | clique no seu nome no cabeçalho: nome, e-mail, perfis de acesso e identificador, buscados por `GET /auth/me` a cada abertura — não do estado do login, que pode estar velho                                                                            |

Todo elemento que a automação alcança tem `data-testid` estável, e os valores
aparecem também em `data-*`. É o que permite ao Playwright comparar a tela com a
API sem depender de texto traduzido nem de posição de coluna.

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

**Duas trilhas completas, cada uma capaz de subir o sistema inteiro sozinha.**
Em stages separados, então coexistem sem disputar recurso. As duas consomem o
mesmo `dist/function.zip`. Ver [ADR 0002](docs/adr/0002-serverless-framework-vs-terraform.md).

|            | Terraform           | Serverless Framework      |
| ---------- | ------------------- | ------------------------- |
| Comando    | `pnpm deploy:local` | `pnpm deploy:sls`         |
| Stage      | `local`             | `sls`                     |
| Estado     | arquivo de state    | stack de CloudFormation   |
| Declaração | `infra/terraform/`  | `apps/api/serverless.yml` |
| Topologia  | uma API, 4 Lambdas  | idêntica                  |

**Pré-requisito das duas:** LocalStack e Postgres no ar — `pnpm infra:up`, ou o
`pnpm start`, que já faz isso. Nenhuma das duas exige a outra.

Subir as duas e ver as duas URLs respondendo:

```bash
pnpm infra:up       # LocalStack + Postgres
pnpm deploy:local   # Terraform  → stage local
pnpm deploy:sls     # Serverless → stage sls
pnpm urls           # imprime as duas, lado a lado
```

Cada trilha roda o smoke — 17 asserções — no fim do próprio deploy, contra a URL
que ela acabou de criar. Para repetir o smoke depois, sem redeploy:

```bash
pnpm smoke                          # alvo: a URL do Terraform (padrão)
API_BASE_URL=<url-do-sls> pnpm smoke   # alvo: a do Serverless
```

> **Não aponte as duas para o mesmo stage.** Cada uma mantém o próprio estado, e
> dois donos do mesmo recurso produzem drift e remoção acidental. Stages
> separados é o que torna a coexistência segura.

### Terraform

```bash
pnpm deploy:local
```

Executa, em ordem: aguarda a infraestrutura → empacota com esbuild → **verifica
paridade de rotas** → `terraform apply` → migrations e seed → smoke test.

É a trilha que `pnpm start` usa, e a única que descreve a infraestrutura durável
(banco, segredos, IAM) — por isso é o caminho padrão do dia a dia.

O build vem antes do Terraform porque ele lê o zip por `filebase64sha256` — invertê-los
publica o artefato da execução anterior.

### Serverless Framework

```bash
pnpm deploy:sls              # build → deploy → migrations → seed → smoke
pnpm deploy:sls:remove       # derruba só o stack do Serverless
```

Provisiona as quatro Lambdas atrás de **uma** API Gateway, mais os segredos que
ela usa — sem depender de `terraform apply` antes. Ao final imprime a URL do
stage `sls`, que responde exatamente como a do Terraform.

Para apontar o backoffice para essa URL em vez da do Terraform, troque
`API_BASE_URL` e `NEXT_PUBLIC_API_BASE_URL` em `apps/web/.env.local` — o Next
recarrega sozinho. O arquivo é gerado por `scripts/localstack/export-outputs.sh`
e volta a apontar para o Terraform no próximo `pnpm start`.

Três detalhes que o LocalStack impõe e que o script já trata: `versionFunctions:
false` (o `PublishVersion` do emulador acusa divergência de `CodeSHA256` mesmo
com artefato idêntico), remoção do stack direto pelo CloudFormation (o `sls
remove` aborta no ECR, não implementado no Community), e cópia dos bundles para
`.artifacts/<serviço>.zip` — o Serverless usa o **nome do arquivo** como chave no
S3, e os quatro `function.zip` colidiriam, fazendo todas as funções rodarem o
mesmo código.

> Recriar um stack apagado não funciona no LocalStack: ele o deixa em
> `REVIEW_IN_PROGRESS`. Reimplantar sobre um stack saudável funciona normalmente;
> recomeçar do zero exige `pnpm reset`.

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

### Pelo pipeline

O deploy manual acima é o que o workflow [`deploy.yml`](.github/workflows/deploy.yml) roteiriza: verificação, empacotamento por serviço, plano, aprovação no GitHub Environment, aplicação, migrations e smoke test — com relatório consolidado ao fim de cada etapa.

O input `trilha` escolhe **quem gerencia o ambiente**: Terraform (padrão) ou Serverless Framework. Independentemente da escolha, o pipeline exercita as **duas** a cada deploy — dois ensaios em paralelo contra LocalStack, cada um provisionando o sistema inteiro e passando pelo mesmo smoke test. Trilha alternativa que nunca roda não é alternativa.

Push em `main` implanta `dev`. `stage` e `prod` só por disparo manual, porque promoção é ato deliberado. Enquanto os segredos de AWS não estiverem configurados, o workflow não falha: publica um relatório dizendo exatamente o que falta.

O CI ([`ci.yml`](.github/workflows/ci.yml)) roda tudo em paralelo — uma suíte por job, um empacotamento por microserviço — e escreve um relatório único no resumo da execução e no comentário do pull request. Detalhes em [`docs/standards/devops/pipeline.md`](docs/standards/devops/pipeline.md).

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

**890 testes** — 290 nos quatro microserviços, 507 nos três pacotes compartilhados
e 93 no backoffice, com nomes em PT-BR descrevendo comportamento.

```bash
pnpm test              # as oito suítes do monorepo
pnpm test:api          # só os microserviços
pnpm test:packages     # só os pacotes compartilhados
pnpm test:web          # só o backoffice
pnpm test:coverage     # tudo, com relatório de cobertura
```

Ou uma suíte de cada vez:

```bash
pnpm --filter @saude-bliss/bliss-requests test        # um microserviço
pnpm --filter @saude-bliss/bliss-requests test:unit   # uma camada dele
pnpm --filter @saude-bliss/core test                  # o runtime compartilhado
```

**A camada `e2e` precisa do Postgres do compose** (`pnpm infra:up`) com as
migrations aplicadas (`pnpm db:migrate`). Sem ele, `SKIP_E2E=1` pula a camada e o
resto roda normalmente.

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

**Cobertura:** as oito suítes fecham em **100%** de statements, branches, funções
e linhas. O limite no `jest.config.js` de cada pacote é **95% nos quatro
critérios**, sem exceção por diretório — o CI barra abaixo disso.

Chegar lá custou cobrir o que o caminho feliz não alcança, e é aí que os testes
pagam:

| Ramo                                      | Como é exercitado                                                  |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `.returning()` vazio, contagem sem linha  | duplo do Drizzle injetado por construtor (`dbPromise`)             |
| origem da API resolvida no servidor       | suíte com `@jest-environment node` — sob jsdom é inalcançável      |
| falha que não é `ApiError`                | rejeição fora do interceptor, que é onde os `??` de fallback valem |
| `.env` ausente na resolução da credencial | `existsSync` mockado, para o resultado não depender da máquina     |

O último é o que mais importa: enquanto a suíte lia o disco de verdade, o mesmo
teste passava por motivos diferentes na máquina de quem escreveu e no runner —
e no runner passava sem afirmar nada.

Os limites são verificados no CI, e vale registrar o que eles pegaram: ao escrever
os testes que faltavam para o `PasswordService` apareceu um defeito real — a
derivação usava o comprimento vindo do **hash armazenado**, então quem controlasse
a linha do banco escolheria quantos bytes precisavam bater, e um hash truncado
passaria a verificar. Corrigido para derivar sempre em `KEY_LENGTH`.

---

## 🤖 Automação da conferência

Automatiza o fluxo operacional diário: abrir a fila, conferir cada solicitação
contra o registro, marcar como revisada.

**Pré-requisitos:** o sistema no ar (`pnpm start`) e os browsers instalados, uma
vez por máquina. O `pnpm start` já grava `apps/automation/.env` com a URL da API e
a do backoffice.

```bash
pnpm --filter @saude-bliss/automation install:browsers   # uma vez
pnpm test:e2e                                            # os 21 cenários, headless e headed
```

Ou de dentro do pacote, com mais controle:

```bash
cd apps/automation
pnpm test          # os dois projects — headless e headed
pnpm test:headed   # só o headed, com UI e em câmera lenta
pnpm test:ui       # modo interativo
pnpm report        # abre o relatório HTML
```

**21 cenários** — smoke, filtros, paginação, conferência diária (incluindo o cancelamento
da confirmação), rastreabilidade e divergências. Rodam contra qualquer uma das duas
trilhas de deploy: o alvo é o `API_BASE_URL` do `.env`.

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

- **Schema estável e fechado** — os campos da solicitação são conhecidos e não
  variam por tipo de ticket.
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

| Decisão                                     | Motivo                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serverless Framework **e** Terraform        | o primeiro é a stack de deploy definida para o projeto; o segundo descreve a infraestrutura durável. Ambos implantam, em stages separados — ADR 0002 |
| `serverless@3`                              | a v4 exige conta e travaria o deploy offline                                                                                                         |
| LocalStack v3 fixado                        | as imagens de 2026 exigem token mesmo para serviços gratuitos                                                                                        |
| `PATCH /reviews/{id}` fora do escopo mínimo | a automação precisa de ação de escrita para ser fluxo, não roteiro de cliques                                                                        |
| `strict: true` no TypeScript                | projeto novo, sem dívida de tipagem a acomodar                                                                                                       |
| Zod 3 em vez de 4                           | `zod-to-json-schema` é Zod-3-only, e um schema alimenta validação e Swagger                                                                          |

### Limitações conhecidas

**O LocalStack Community não executa custom authorizers.** A configuração está
correta — `aws apigateway get-method` devolve `authorizationType: CUSTOM` com o
`authorizerId` do authorizer criado — mas a emulação não chega a invocá-lo. O smoke
detecta se a borda aplica autorização e, quando não aplica, valida o authorizer por
invocação direta com o mesmo contrato de evento `REQUEST`.

**O deploy exercitado aqui é local.** O mesmo HCL sobe em AWS real com
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
