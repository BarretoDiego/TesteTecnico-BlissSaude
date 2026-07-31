# CLAUDE.md — Diretrizes do projeto

> Última atualização: 2026-07-31

Guia de padrões para agentes e pessoas trabalhando neste repositório. As regras aqui **sobrepõem** comportamento padrão.

## 🏗️ Arquitetura

Monorepo pnpm. **Um microserviço por domínio, uma Lambda por microserviço**; tudo que é compartilhado vive fora deles, em `packages/`.

```
saude-bliss/
├── packages/                       # compartilhado — nenhum pacote aqui conhece domínio
│   ├── contracts/                  # enums, schemas Zod, envelope. Fonte única da verdade
│   ├── core/                       # factory de app, logging, erros, contexto, config, Lambda
│   │                               # + aws/: EventBridge, SQS, S3, CloudWatch, SecretsManager
│   ├── database/                   # schema Drizzle, client, migrations, seed, mappers
│   └── testing/                    # factories e duplos das suítes
├── apps/api/
│   ├── functions/
│   │   ├── bliss-requests/         # domínio: abertura e consulta de solicitações
│   │   └── bliss-reviews/          # domínio: conferência e trilha de auditoria
│   └── run.all.local.ts            # sobe todos num processo só (desenvolvimento)
├── apps/web/                       # backoffice Next.js
├── apps/automation/                # suíte Playwright
└── infra/terraform/                # IaC — única coisa que cria ou muda recursos
```

**Convenção de nome:** `bliss-<domínio>`, no plural (`bliss-requests`, `bliss-reviews`, e adiante `bliss-users`, `bliss-companies`). O nome é usado como está no diretório, no pacote pnpm, na função Lambda, no log group e no `serviceName` dos logs — um nome, um serviço, rastreável ponta a ponta.

### Estrutura de um microserviço

```
apps/api/functions/bliss-<domínio>/
├── src/
│   ├── app.ts                  # createApp(...) + createLambdaHandler — só declara o que é do domínio
│   ├── router/index.ts         # SOMENTE a tabela de rotas
│   ├── controllers/            # {Domain}Controller.ts — orquestração fina
│   ├── middlewares/            # {Action}Middleware.ts — Zod + validação de entrada
│   ├── services/               # {Domain}Service.ts    — regras de domínio
│   └── repositories/           # {Domain}Repository.ts — acesso a dados
├── __tests__/{unit,integration,contract,e2e,.jest}/
├── run.local.ts                # sobe só este domínio, na porta dele
├── build.js                    # esbuild → dist/function.zip
├── serverless.yml              # emulação local + packaging
├── jest.config.js  package.json  tsconfig.json
```

Dentro de `src/` os imports são **relativos**; para fora, sempre pelo nome do pacote (`@saude-bliss/core`). Não há alias `@/`: um único processo (`run.all.local.ts`) carrega os dois serviços e não conseguiria resolver dois mapeamentos `@/*` distintos.

### Como rodar

| Comando                                         | O que faz                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm --filter @saude-bliss/api dev`            | todos os domínios em um processo, porta 4000 — loop de desenvolvimento |
| `pnpm --filter @saude-bliss/bliss-requests dev` | só solicitações, porta 4001                                            |
| `pnpm --filter @saude-bliss/bliss-reviews dev`  | só conferência, porta 4002                                             |

O modo agregado existe para conveniência; o isolado é o que reproduz produção. `PORT` vale só para o agregado — o isolado usa a porta fixa do serviço, sobrescrevível por `SERVICE_PORT`.

### Fronteiras

- `packages/core` **não pode** importar `packages/database`: plataforma não depende de persistência. Um serviço sem banco não deve carregar o driver do Postgres. É por isso que `runLocal` recebe `onShutdown` em vez de importar `closeDb`.
- O **schema** é compartilhado (uma tabela, uma definição), as **queries** não: cada serviço tem seu `*DatabaseService` com apenas as operações do seu domínio.
- Nada em `packages/` pode conhecer um domínio. Se um símbolo precisa saber o que é uma "solicitação", ele pertence ao microserviço.
- `BlissLogger` lê `process.env` direto, sem passar pelo `EnvService`. É o único módulo com essa licença: ele é a base de `WithLogging` e portanto de `BaseService`, então importar o serviço de configuração — que também é um `BaseService` — criaria ciclo. Logging precisa existir antes de qualquer serviço.
- **Toda** classe de serviço estende `BaseService`, inclusive `EnvService`, `SecretsService` e as integrações AWS. Serviço sem logging é ponto cego em produção.
- Integração AWS que é efeito colateral (EventBridge, SQS, CloudWatch) **não lança**: falha ali não pode derrubar operação de negócio já persistida. Vira log de erro, que é o gancho do alarme.

### Responsabilidades

| Camada         | Faz                                                           | Não faz                 |
| -------------- | ------------------------------------------------------------- | ----------------------- |
| **Router**     | declara `method`, `url`, `schema`, `preValidation`, `handler` | qualquer lógica         |
| **Middleware** | schemas Zod, parse, validações de entrada                     | CRUD, acesso a banco    |
| **Controller** | log start/success, chama service, monta envelope              | regra de negócio, query |
| **Service**    | regras de domínio, orquestração                               | SQL direto              |
| **Repository** | Drizzle, transações. Único que importa `db`                   | regra de negócio        |
| **AWS**        | integrações (`packages/core/src/aws/`), com logging           | regra de domínio        |

## 🔧 Padrões de código

### Middleware — nomenclatura obrigatória

Cada endpoint tem um arquivo `{Action}{Domain}Middleware.ts` exportando, nesta ordem:

```typescript
export const CreateRequestBodySchema = z.object({ ... });
export const CreateRequestResponseSchema = z.object({ ... });
export type TCreateRequestBody = z.infer<typeof CreateRequestBodySchema>;
export type TCreateRequestFastifyRequest = { Body: TCreateRequestBody };

export const CreateRequestMiddleware = async (req, res) => {
	try {
		req.body = CreateRequestBodySchema.parse(req.body);
	} catch (error) {
		return DefaultErroHandler(error, res);
	}
};

export const CreateRequestResponseMiddleware = async (req, res, payload) => { ... };

/** Schema JSON para o Fastify/Swagger. */
export const CreateRequestSchema = {
	tags: ["requests"],
	body: zodToJsonSchema(CreateRequestBodySchema),
	response: { 201: ..., ...DefaultSBErrorSchema },
};
```

### Controller — fino

```typescript
class RequestsController extends BaseController {
	constructor(private readonly requests: RequestsService = new RequestsService()) {
		super();
	}

	create = async (req: FastifyRequest<TCreateRequestFastifyRequest>, res: FastifyReply) => {
		try {
			this.logStart("RequestsController", "create", "criando solicitação");
			const result = await this.requests.create(req.body);
			this.logSuccess("RequestsController", "create", "solicitação criada", { id: result.id });
			return blissSuccess(res, req, { data: result, statusCode: 201 });
		} catch (error) {
			this.logError("RequestsController", "create", "falha ao criar solicitação", { error });
			return sbErrorHandler(res, req, error, { module: "RequestsController", action: "create" });
		}
	};
}

export default new RequestsController();
```

Dependências entram por **default de construtor** — testa fácil, sem container de DI.

### Envelope de resposta

Toda resposta, sem exceção:

```jsonc
// sucesso
{ "success": true, "data": { ... }, "message": "...", "requestId": "...", "timestamp": "..." }
// erro
{ "success": false, "error": { "code": "REQUEST_NOT_FOUND", "message": "...", "details": {} }, "requestId": "...", "timestamp": "..." }
```

### Erros

`BlissError.from("CODE", { details })` a partir do catálogo em `errors/catalog.ts`, que mapeia código → `httpStatus` + mensagem PT-BR. Nunca lançar `Error` cru em código de domínio.

### Logging

Classes de domínio estendem `WithLogging` e usam `logStart / logInfo / logSuccess / logWarning / logFailed / logError(module, action, message, params?)`. Cada linha sai como **um JSON com `requestId` no topo** — é o que faz o CloudWatch Logs Insights funcionar sem parse.

O logger lê o `requestId` do `AsyncLocalStorage`, **não** de um parâmetro. Por isso services e repositories nunca recebem `req`.

## 📋 Regras obrigatórias

1. **Zod em todo endpoint** — sem exceção, entrada e saída.
2. **Enums vivem em `packages/contracts`** — o `pgEnum` do Drizzle é construído a partir do literal de lá. Três cópias divergem; uma não.
3. **Controllers não têm regra de negócio.**
4. **Só o repository importa `db`.**
5. **Frontend nunca chama `fetch`/axios de dentro de componente** — sempre via `services/`.
6. **`data-testid` estável em toda linha e célula da tabela** — retrofit de seletor é o que torna suíte Playwright flaky.
7. **Router recebe o prefixo por parâmetro** e declara `ROUTES` — é o que alimenta o log de inicialização e o verificador de paridade com o `serverless.yml`.
8. **`run.local.ts` e `run.all.local.ts` não montam aplicação**: declaram e delegam a `createApp`/`createAggregatedApp` + `runLocal`. Os dois modos precisam vir do mesmo código, senão o desenvolvimento deixa de reproduzir produção.
9. **Terraform é a única coisa que toca infraestrutura.** Serverless Framework é emulador local e packager, nunca deploy.
10. **Filtro de listagem vive na URL**, não em estado React.
11. **Nome de teste em PT-BR descrevendo comportamento**: `it("retorna 404 quando a solicitação não existe")`.
12. **Documentação entra no mesmo commit do código.**

## 🧪 Testes

Layout `<pacote>/__tests__/{unit,integration,e2e,contract}` — os testes ficam junto do código que testam. Testes do runtime compartilhado em `packages/core/__tests__`, testes de domínio em `apps/api/functions/bliss-*/__tests__`. Factories e duplos vêm de `@saude-bliss/testing`.

- **unit** — tudo mockado, sem I/O.
- **integration** — `app.inject()`, repository mockado.
- **e2e** — Postgres real com migrations aplicadas.
- **contract** — snapshot do `zodToJsonSchema`; pega drift entre front e API.

Cobertura: **95%** em `middlewares/`, `services/`, `utils/`, `errors/`; **90%** global. Exclusões: `app.ts`, `router/index.ts`, `types/**`, barrels `index.ts`.

## 📝 Convenções

- **Commits**: `type(scope): description` em inglês. `feat|fix|refactor|docs|chore|perf|test`; escopo `api|web|automation|infra|docs`.
- **Prosa** (README, docs, mensagens de erro, nomes de teste) em **PT-BR**; **identificadores** em inglês.
- **Prettier**: tabs, largura 120, aspas duplas. `pnpm format` antes de commitar.
- **TypeScript `strict: true`** — desvio consciente do backend da casa, documentado em `docs/standards/global/typescript-configuration.md`.
- Todo doc em `docs/` abre com `> Última atualização: YYYY-MM-DD`.

## 🚨 Armadilhas conhecidas

- **`pg` no esbuild**: `pg-native` e `cloudflare:sockets` não resolvem — ver os `external` no `build.js` de cada microserviço. Falha aqui aparece como crash de cold start dentro do LocalStack, que é péssimo lugar para debugar. O build faz smoke check do bundle de propósito.
- **Pool em Lambda**: singleton em escopo de módulo (`packages/database/src/client.ts`) com `max: 1`. Nunca `pool.end()` por request. `callbackWaitsForEmptyEventLoop: false`.
- **`enterWith` do AsyncLocalStorage** vaza o store entre invocações em container reutilizado — por isso `lambdaHandler` envolve tudo em `als.run(...)`.
- **Next 16**: `params` e `searchParams` são `Promise` e precisam de `await`.
- **`awslocal` não serve aqui** — ele assume a porta 4566. Use `scripts/localstack/aws.sh`.
