/**
 * @module core/app/swagger
 *
 * Documentação OpenAPI, parametrizada por microserviço.
 *
 * A UI sobe apenas em ambiente local: em produção seria superfície de ataque sem
 * contrapartida. O documento JSON (`/docs/json`) continua disponível em todo
 * ambiente, o que permite gerar cliente e rodar teste de contrato no pipeline.
 */

import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { EnvService } from "../config/EnvService";

interface SwaggerOptions {
	serviceName: string;
	description: string;
	tags?: Array<{ name: string; description: string }>;
}

export async function setupSwagger(app: FastifyInstance, options: SwaggerOptions): Promise<void> {
	await app.register(fastifySwagger, {
		openapi: {
			info: {
				title: `Saúde Bliss — ${options.serviceName}`,
				description:
					`${options.description}\n\n` +
					"Toda resposta segue o envelope padrão com `requestId`, que é o mesmo id " +
					"presente no header `x-request-id` e nas linhas de log do CloudWatch.",
				version: process.env.SERVICE_VERSION ?? "1.0.0",
			},
			tags: [...(options.tags ?? []), { name: "health", description: "Saúde do serviço" }],
		},
	});

	if (EnvService.isLocalEnv()) {
		await app.register(fastifySwaggerUi, {
			routePrefix: "/docs",
			uiConfig: { docExpansion: "list", deepLinking: true },
		});
	}
}
