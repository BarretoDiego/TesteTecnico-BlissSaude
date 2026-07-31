# Como adicionar uma rota

> Última atualização: 2026-07-31

Uma rota é declarada em **três lugares**. `pnpm --filter @saude-bliss/api check:routes`
compara os três e falha o CI na divergência.

## 1. Router do Fastify

`apps/api/functions/<serviço>/src/router/index.ts`

```typescript
export const ROUTE_PREFIX = "/reviews";

export const ROUTES: readonly RouteDescriptor[] = [
	{ method: "PATCH", path: "/:id" },
	{ method: "GET", path: "/:id/timeline" },
];

export default async function router(app: FastifyInstance, options: RouterOptions) {
	app.route({
		method: "PATCH",
		url: "/:id",
		schema: ReviewRequestSchema, // Zod → JSON Schema, do middleware
		preValidation: [ReviewRequestMiddleware],
		handler: ReviewsController.review,
	});

	describeRoutes(app, options, ROUTES);
}
```

O router recebe o prefixo resolvido por parâmetro — é isso que alimenta o log de
inicialização e deixa o agrupamento explícito no arquivo de rotas.

## 2. Terraform do serviço

`infra/terraform/modules/services/<serviço>/main.tf`

```hcl
routes = {
  "PATCH /{id}"        = {}                          # herda CUSTOM
  "GET /{id}/timeline" = {}
  "GET /health"        = { authorization = "NONE" }  # público
}
```

Chave é `"MÉTODO /caminho"`, relativo ao prefixo do domínio. Opções por rota:

| Campo           | Default    | Uso                                              |
| --------------- | ---------- | ------------------------------------------------ |
| `authorization` | `CUSTOM`   | `NONE` para rota pública, `AWS_IAM` para máquina |
| `authorizer_id` | do serviço | um authorizer diferente só para esta rota        |
| `api_key`       | `false`    | exige `x-api-key`                                |

Declarar rota a rota — em vez de um `{proxy+}` — é o que permite autorização **por
método** e faz o API Gateway recusar caminho inexistente sem gastar invocação.

**Limite:** dois segmentos abaixo do domínio (`/{id}/timeline`). O Terraform não
permite `for_each` auto-referente, então a árvore é montada em níveis explícitos.
Um terceiro nível é mais um bloco no mesmo formato.

## 3. `serverless.yml`

Só o prefixo, para o `sls offline` emular o API Gateway. Não muda ao adicionar rota
dentro de um domínio já existente.

## Convenção de parâmetros

Fastify usa `/:id`; API Gateway usa `/{id}`. O verificador traduz entre os dois — não
tente uniformizar.
