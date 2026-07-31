# CLAUDE.md — Diretrizes do projeto

> Última atualização: 2026-07-30

Guia de padrões para agentes e pessoas trabalhando neste repositório. As regras aqui **sobrepõem** comportamento padrão.

## 🏗️ Arquitetura

Monorepo pnpm com quatro pacotes:

| Pacote               | Papel                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `packages/contracts` | Enums + schemas Zod + tipos compartilhados. **Fonte única da verdade** |
| `apps/api`           | Fastify sobre AWS Lambda (API Gateway REST)                            |
| `apps/web`           | Backoffice Next.js (App Router)                                        |
| `apps/automation`    | Suíte Playwright de conferência operacional                            |
| `infra/terraform`    | IaC — única coisa que cria ou muda recursos                            |

### Estrutura da API

```
apps/api/src/
├── app.ts              # Fastify + plugins + hooks + lambdaHandler
├── router/index.ts     # SOMENTE a tabela de rotas
├── controllers/        # {Domain}Controller.ts — orquestração fina
├── middlewares/        # {Action}Middleware.ts — Zod + regras de negócio
├── services/           # {Domain}Service.ts — regras de domínio
│                       # {Domain}DatabaseService.ts — acesso a dados
├── common/             # WithLogging, BaseController, BaseService, BaseRepository
├── errors/             # SBError, catálogo de códigos, DefaultErroHandler
├── utils/              # requestContext, responseEnvelope, SBLogger
├── config/             # EnvService, SecretsService
└── db/                 # client Drizzle, schema, migrations, seed
```

### Responsabilidades

| Camada         | Faz                                                           | Não faz                 |
| -------------- | ------------------------------------------------------------- | ----------------------- |
| **Router**     | declara `method`, `url`, `schema`, `preValidation`, `handler` | qualquer lógica         |
| **Middleware** | schemas Zod, parse, validações de entrada                     | CRUD, acesso a banco    |
| **Controller** | log start/success, chama service, monta envelope              | regra de negócio, query |
| **Service**    | regras de domínio, orquestração                               | SQL direto              |
| **Repository** | Drizzle, transações. Único que importa `db`                   | regra de negócio        |

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
			return sbSuccess(res, req, { data: result, statusCode: 201 });
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

`SBError.from("CODE", { details })` a partir do catálogo em `errors/catalog.ts`, que mapeia código → `httpStatus` + mensagem PT-BR. Nunca lançar `Error` cru em código de domínio.

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
7. **Terraform é a única coisa que toca infraestrutura.** Serverless Framework é emulador local e packager, nunca deploy.
8. **Filtro de listagem vive na URL**, não em estado React.
9. **Nome de teste em PT-BR descrevendo comportamento**: `it("retorna 404 quando a solicitação não existe")`.
10. **Documentação entra no mesmo commit do código.**

## 🧪 Testes

Layout `apps/api/__tests__/{unit,integration,e2e,contract,helpers}`:

- **unit** — tudo mockado, sem I/O.
- **integration** — `app.inject()`, repository mockado.
- **e2e** — Postgres real com migrations aplicadas.
- **contract** — snapshot do `zodToJsonSchema`; pega drift entre front e API.

Cobertura: **95%** em `middlewares/`, `services/`, `utils/`, `errors/`; **90%** global. Exclusões: `app.ts`, `router/index.ts`, `swagger.ts`, `types/**`.

## 📝 Convenções

- **Commits**: `type(scope): description` em inglês. `feat|fix|refactor|docs|chore|perf|test`; escopo `api|web|automation|infra|docs`.
- **Prosa** (README, docs, mensagens de erro, nomes de teste) em **PT-BR**; **identificadores** em inglês.
- **Prettier**: tabs, largura 120, aspas duplas. `pnpm format` antes de commitar.
- **TypeScript `strict: true`** — desvio consciente do backend da casa, documentado em `docs/standards/global/typescript-configuration.md`.
- Todo doc em `docs/` abre com `> Última atualização: YYYY-MM-DD`.

## 🚨 Armadilhas conhecidas

- **`pg` no esbuild**: `pg-native` e `cloudflare:sockets` não resolvem — ver os `external` em `apps/api/build.js`. Falha aqui aparece como crash de cold start dentro do LocalStack, que é péssimo lugar para debugar. O build faz smoke check do bundle de propósito.
- **Pool em Lambda**: singleton em escopo de módulo com `max: 1`. Nunca `pool.end()` por request. `callbackWaitsForEmptyEventLoop: false`.
- **`enterWith` do AsyncLocalStorage** vaza o store entre invocações em container reutilizado — por isso `lambdaHandler` envolve tudo em `als.run(...)`.
- **Next 16**: `params` e `searchParams` são `Promise` e precisam de `await`.
- **`awslocal` não serve aqui** — ele assume a porta 4566. Use `scripts/localstack/aws.sh`.
