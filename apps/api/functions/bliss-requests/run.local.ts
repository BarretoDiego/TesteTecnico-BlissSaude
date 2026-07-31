/**
 * Servidor local isolado do microserviço `bliss-requests`.
 *
 * Sobe **apenas este domínio**, na porta 4001 (sobrescreva com `SERVICE_PORT`) — que é como ele roda em
 * produção, uma Lambda por domínio. Para levantar todos de uma vez em um único
 * processo, use `pnpm dev` na raiz de `apps/api` (`run.all.local.ts`).
 */

import { config } from "dotenv";

// Antes de qualquer import da aplicação: EnvService lê `process.env` no carregamento.
config({ path: ["../../.env.local", "../../.env", "../../../../.env"] });

async function main(): Promise<void> {
	const { buildApp, SERVICE_NAME } = await import("./src/app");
	const { runLocal } = await import("@saude-bliss/core");
	const { closeDb } = await import("@saude-bliss/database");
	await runLocal({
		serviceName: SERVICE_NAME,
		buildApp,
		onShutdown: closeDb,
		port: Number(process.env.SERVICE_PORT ?? 4001),
	});
}

main().catch((error) => {
	console.error("falha ao iniciar o serviço:", error);
	process.exit(1);
});
