/**
 * @module core/app/runLocal
 *
 * Servidor HTTP local de um microserviço.
 *
 * Compartilhado para que `run.local.ts` de cada serviço seja apenas a
 * declaração de qual app subir e em que porta. Também é o que permite o
 * `run.all.local.ts` levantar todos os serviços em processos idênticos.
 */

import type { FastifyInstance } from "fastify";
import { envService } from "../config/EnvService";

export interface RunLocalOptions {
	serviceName: string;
	buildApp: () => Promise<FastifyInstance>;
	/** Porta fixa do serviço. Cai para `PORT` e depois para o default do EnvService. */
	port?: number;
	/**
	 * Liberação de recursos no encerramento — tipicamente fechar o pool do banco.
	 *
	 * Injetado pelo serviço em vez de importado aqui: `core` não pode conhecer
	 * `database`, senão a camada de plataforma passa a depender da de persistência
	 * e um serviço sem banco carregaria o driver do Postgres sem precisar.
	 */
	onShutdown?: () => Promise<void>;
}

/**
 * Sobe o serviço e registra encerramento gracioso.
 *
 * Liberar recursos no shutdown não é detalhe: sem isso o `ts-node-dev` deixa
 * conexões órfãs no Postgres a cada reload e o banco esgota o limite em minutos
 * de desenvolvimento.
 */
export async function runLocal(options: RunLocalOptions): Promise<FastifyInstance> {
	const app = await options.buildApp();
	const port = options.port ?? envService.getPort();
	const prefix = envService.getApiPrefix();

	await app.listen({ port, host: "0.0.0.0" });

	console.log(`\n  ${options.serviceName}`);
	console.log(`    API      http://localhost:${port}${prefix}`);
	console.log(`    Swagger  http://localhost:${port}/docs`);
	console.log(`    Health   http://localhost:${port}${prefix}/health\n`);

	const shutdown = async (signal: string) => {
		console.log(`\n[${options.serviceName}] ${signal} recebido, encerrando...`);
		await app.close();
		await options.onShutdown?.();
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));

	return app;
}
