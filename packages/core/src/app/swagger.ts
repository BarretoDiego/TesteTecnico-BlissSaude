/**
 * @module core/app/swagger
 *
 * Documentação OpenAPI, parametrizada por microserviço.
 *
 * A UI sobe apenas fora da Lambda. São duas razões distintas:
 *
 * 1. Em ambiente publicado seria superfície de ataque sem contrapartida.
 * 2. O plugin lê os assets estáticos do **disco**, e o bundle da Lambda contém
 *    só o JavaScript. Registrar a UI lá derruba toda requisição com ENOENT antes
 *    mesmo de chegar à rota.
 *
 * A checagem é `isLocalEnv() && !isLambdaRuntime()`, não só a primeira: uma
 * Lambda implantada no LocalStack roda com `BLISS_ENV=local`. `local` é o nome
 * do ambiente, não o contexto de execução.
 *
 * O documento JSON (`/docs/json`) continua disponível em todo ambiente, o que
 * permite gerar cliente e rodar teste de contrato no pipeline.
 */

import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { envService } from "../config/EnvService";

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

	if (envService.isLocalEnv() && !envService.isLambdaRuntime()) {
		await app.register(fastifySwaggerUi, {
			routePrefix: "/docs",
			uiConfig: { docExpansion: "list", deepLinking: true },
		});
	}
}
