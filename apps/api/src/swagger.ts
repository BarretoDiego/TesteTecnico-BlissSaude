/**
 * @module api/swagger
 *
 * Documentação OpenAPI.
 *
 * A UI sobe apenas em ambiente local: em produção seria superfície de ataque sem
 * contrapartida. O documento JSON (`/docs/json`) continua disponível em todo
 * ambiente, o que permite gerar cliente ou rodar teste de contrato no pipeline.
 */

import { EnvService } from "@/config/EnvService";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

export async function setupSwagger(app: FastifyInstance): Promise<void> {
	await app.register(fastifySwagger, {
		openapi: {
			info: {
				title: "Saúde Bliss — API de Solicitações",
				description:
					"Gestão de solicitações (tickets) criadas e consultadas via app ou backoffice.\n\n" +
					"Toda resposta segue o envelope padrão com `requestId`, que é o mesmo id " +
					"presente no header `x-request-id` e nas linhas de log do CloudWatch.",
				version: "1.0.0",
			},
			tags: [
				{ name: "requests", description: "Solicitações" },
				{ name: "health", description: "Saúde da aplicação" },
			],
		},
	});

	if (EnvService.isLocalEnv()) {
		await app.register(fastifySwaggerUi, {
			routePrefix: "/docs",
			uiConfig: { docExpansion: "list", deepLinking: true },
		});
	}
}
