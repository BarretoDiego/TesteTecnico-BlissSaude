/**
 * Sobe todos os microserviços em um único processo.
 *
 * Padrão da casa (`run.all.local.ts`): um processo para acompanhar, um Swagger
 * com a API inteira, e o backoffice apontando para uma única origem sem CORS nem
 * proxy.
 *
 * O arquivo é só declaração — quem monta a aplicação é `createAggregatedApp` e
 * quem sobe o servidor é `runLocal`, os mesmos helpers usados pelo `run.local.ts`
 * de cada serviço. É o que garante que o modo agregado e o isolado se comportem
 * igual: contexto de requisição, CORS, envelope de erro e encerramento gracioso
 * vêm do mesmo código nos dois.
 *
 * **Não é como roda em produção.** Lá cada domínio é uma Lambda independente
 * atrás do mesmo API Gateway. Para exercitar um serviço isolado — inclusive o
 * `/health` e o Swagger dele — use `pnpm --filter @saude-bliss/bliss-requests dev`.
 */

import { config } from "dotenv";

// Antes de qualquer import da aplicação: `EnvService` lê `process.env` no
// carregamento do módulo, então definir depois não teria efeito.
config({ path: [".env.local", ".env", "../../.env"] });

import { createAggregatedApp, runLocal } from "@saude-bliss/core";
import { closeDb } from "@saude-bliss/database";

import { service as blissRequests } from "./functions/bliss-requests/src/service";
import { service as blissReviews } from "./functions/bliss-reviews/src/service";

/**
 * Registro dos domínios.
 *
 * Cada entrada é a **mesma** definição que o `app.ts` do serviço usa para montar
 * a Lambda — nome, prefixo, rotas e sonda de saúde vêm de uma fonte só. Um
 * serviço novo entra aqui e no `serverless.yml` dele.
 */
const SERVICES = [blissRequests, blissReviews];

async function main(): Promise<void> {
	await runLocal({
		serviceName: "api agregada (bliss-requests, bliss-reviews)",
		buildApp: () => createAggregatedApp({ services: SERVICES }),
		onShutdown: closeDb,
		port: Number(process.env.PORT ?? 4000),
	});
}

main().catch((error) => {
	console.error("falha ao iniciar a API agregada:", error);
	process.exit(1);
});
