/**
 * @module core/app/createAggregatedApp
 *
 * Monta todos os microserviços em um processo só, para desenvolvimento local.
 *
 * Reaproveita `applyPlatform` — o mesmo código que a factory de serviço único
 * usa. Essa é a razão de o arquivo existir: quando o modo agregado duplicava a
 * configuração de CORS, hooks e handlers, os dois modos podiam divergir em
 * silêncio e o desenvolvimento deixava de reproduzir produção.
 *
 * **Não é como roda em produção.** Lá cada domínio é uma Lambda independente
 * atrás do mesmo API Gateway. Os caminhos das rotas são idênticos nos dois modos,
 * o que é justamente o que torna o agregado útil.
 */

import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { envService } from "../config/EnvService";
import { applyPlatform } from "./createApp";
import type { DomainRouter } from "./router";

export interface AggregatedService {
	name: string;
	router: DomainRouter;
	/** Tag do OpenAPI que agrupa as rotas do domínio. */
	tag: string;
	description: string;
}

export interface CreateAggregatedAppOptions {
	services: readonly AggregatedService[];
	prefix?: string;
}

export async function createAggregatedApp(options: CreateAggregatedAppOptions): Promise<FastifyInstance> {
	const prefix = options.prefix ?? envService.getApiPrefix();

	const app = fastify({
		genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) || randomUUID(),
		logger: { level: envService.getLogLevel() },
		trustProxy: true,
		bodyLimit: 1024 * 1024,
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
			tags: [
				...options.services.map((service) => ({ name: service.tag, description: service.description })),
				{ name: "health", description: "Saúde do processo agregado" },
			],
		},
	});
	await app.register(fastifySwaggerUi, { routePrefix: "/docs", uiConfig: { docExpansion: "list" } });

	// Mesmo código de plataforma da factory de serviço único.
	await applyPlatform(app, "aggregated");

	for (const service of options.services) {
		await app.register(async (instance) => service.router(instance, { prefix, serviceName: service.name }), {
			prefix,
		});
	}

	/**
	 * Health do processo agregado.
	 *
	 * Difere do `/health` de serviço de propósito: aqui há um processo só, então
	 * o que se reporta é quais domínios ele está servindo. O `mode` no payload
	 * evita que alguém confunda esta resposta com a de um serviço isolado.
	 */
	app.get(`${prefix}/health`, async (req, reply) =>
		reply.header(REQUEST_ID_HEADER, req.id).send({
			success: true,
			data: {
				status: "ok",
				mode: "aggregated",
				services: options.services.map((service) => service.name),
				env: envService.getEnv(),
			},
			requestId: req.id,
			timestamp: new Date().toISOString(),
		})
	);

	return app;
}
