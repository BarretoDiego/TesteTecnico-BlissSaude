/**
 * @module api/run.local
 *
 * Servidor HTTP local.
 *
 * Loop de desenvolvimento rápido, sem emulação de Lambda no caminho. O mesmo
 * `buildApp()` que a Lambda usa — então o que funciona aqui funciona lá, exceto
 * pelo formato do evento do API Gateway, que é justamente o que
 * `serverless offline` cobre.
 */

import { config } from "dotenv";

// Antes de qualquer import da app: EnvService lê `process.env` no carregamento.
config({ path: [".env.local", ".env"] });

import { buildApp } from "@/app";
import { EnvService } from "@/config/EnvService";
import { closeDb } from "@/db/client";

async function main(): Promise<void> {
	const app = await buildApp();
	const port = EnvService.getPort();

	await app.listen({ port, host: "0.0.0.0" });

	const prefix = EnvService.getApiPrefix();
	console.log(`\n  API      http://localhost:${port}${prefix}`);
	console.log(`  Swagger  http://localhost:${port}/docs`);
	console.log(`  Health   http://localhost:${port}${prefix}/health\n`);

	// Encerramento gracioso: sem fechar o pool, `ts-node-dev` deixa conexões
	// órfãs no Postgres a cada reload e o banco esgota o limite em minutos.
	const shutdown = async (signal: string) => {
		console.log(`\n${signal} recebido, encerrando...`);
		await app.close();
		await closeDb();
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
	console.error("falha ao iniciar a API:", error);
	process.exit(1);
});
