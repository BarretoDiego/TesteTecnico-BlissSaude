/**
 * Sobe todos os microserviços em um único processo.
 *
 * Padrão da casa (`run.all.local.ts`): monta os routers de todos os domínios em
 * uma Fastify só, na porta 4000. É o loop de desenvolvimento — um processo para
 * acompanhar, um Swagger com a API inteira, e o backoffice apontando para uma
 * única origem sem CORS nem proxy.
 *
 * **Não é como roda em produção.** Lá cada domínio é uma Lambda independente,
 * atrás do mesmo API Gateway. Para exercitar um serviço isolado — inclusive o
 * `/health` e o Swagger dele — use `pnpm --filter @saude-bliss/bliss-requests dev`,
 * que sobe só aquele domínio na porta dele.
 */

import { config } from "dotenv";

// Antes de qualquer import da aplicação: EnvService lê `process.env` no carregamento.
config({ path: [".env.local", ".env", "../../.env"] });

import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import { DefaultErroHandler, EnvService, blissFail, enterRequestContext } from "@saude-bliss/core";
import { closeDb } from "@saude-bliss/database";
import fastify from "fastify";
import { randomUUID } from "node:crypto";

import blissRequestsRouter from "./functions/bliss-requests/src/router";
import blissReviewsRouter from "./functions/bliss-reviews/src/router";

/** Registro dos domínios. Um serviço novo entra aqui e no `serverless.yml` dele. */
const SERVICES = [
	{ name: "bliss-requests", router: blissRequestsRouter, tag: "requests", description: "Solicitações" },
	{ name: "bliss-reviews", router: blissReviewsRouter, tag: "reviews", description: "Conferência" },
];

const PORT = Number(process.env.PORT ?? 4000);

async function main(): Promise<void> {
	const app = fastify({
		genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) || randomUUID(),
		logger: { level: EnvService.getLogLevel() },
		trustProxy: true,
		bodyLimit: 1024 * 1024,
	});

	await app.register(fastifyCors, {
		origin: EnvService.optional("CORS_ORIGIN", "*"),
		methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", REQUEST_ID_HEADER],
		exposedHeaders: [REQUEST_ID_HEADER],
	});

	await app.register(fastifySwagger, {
		openapi: {
			info: {
				title: "Saúde Bliss — API agregada (desenvolvimento)",
				description:
					"Todos os microserviços montados em um processo para desenvolvimento local.\n\n" +
					"Em produção cada domínio é uma Lambda independente atrás do mesmo API Gateway; " +
					"os caminhos das rotas são idênticos nos dois modos.",
				version: "1.0.0",
			},
			tags: SERVICES.map((service) => ({ name: service.tag, description: service.description })),
		},
	});
	await app.register(fastifySwaggerUi, { routePrefix: "/docs", uiConfig: { docExpansion: "list" } });

	// Mesmo contrato de rastreabilidade da factory compartilhada: o modo agregado
	// precisa se comportar igual ao isolado, senão o desenvolvimento local deixa
	// de ser representativo.
	app.addHook("onRequest", async (req, reply) => {
		reply.header(REQUEST_ID_HEADER, req.id);
		enterRequestContext({
			requestId: req.id,
			method: req.method,
			route: req.routeOptions?.url,
			startedAt: Date.now(),
		});
	});

	app.setErrorHandler((error, req, reply) =>
		DefaultErroHandler(error, reply, req, { module: "run.all.local", action: "onError" })
	);
	app.setNotFoundHandler((req, reply) =>
		blissFail(reply, req, 404, {
			code: "REQUEST_NOT_FOUND",
			message: "Rota não encontrada",
			details: { method: req.method, url: req.url },
		})
	);

	const prefix = EnvService.getApiPrefix();
	for (const service of SERVICES) {
		await app.register(service.router, { prefix });
	}

	// Health agregado: reporta o processo inteiro, já que aqui é um só. O
	// `/health` por serviço continua existindo quando cada um sobe isolado.
	app.get(`${prefix}/health`, async (req, reply) =>
		reply.header(REQUEST_ID_HEADER, req.id).send({
			success: true,
			data: { status: "ok", mode: "aggregated", services: SERVICES.map((s) => s.name), env: EnvService.getEnv() },
			requestId: req.id,
			timestamp: new Date().toISOString(),
		})
	);

	await app.listen({ port: PORT, host: "0.0.0.0" });

	console.log("\n  Saúde Bliss — API agregada (desenvolvimento)\n");
	console.log(`    API      http://localhost:${PORT}${prefix}`);
	console.log(`    Swagger  http://localhost:${PORT}/docs`);
	console.log(`    Health   http://localhost:${PORT}${prefix}/health`);
	console.log(`\n    domínios: ${SERVICES.map((s) => s.name).join(", ")}\n`);

	// Encerramento gracioso: sem fechar o pool, o `ts-node-dev` deixa conexões
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
	console.error("falha ao iniciar a API agregada:", error);
	process.exit(1);
});
