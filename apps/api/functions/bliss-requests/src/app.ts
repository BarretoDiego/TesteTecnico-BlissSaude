/**
 * @module bliss-requests/app
 *
 * Microserviço de solicitações — abertura e consulta.
 *
 * Uma Lambda por domínio: todas as rotas de solicitações vivem nesta função, e
 * escalam, fazem deploy e são observadas como uma unidade. Toda a plataforma
 * (contexto de requisição, envelope, CORS, `/health`, adaptador Lambda) vem da
 * factory compartilhada — este arquivo declara apenas o que é deste domínio.
 */

import { createApp, createLambdaHandler } from "@saude-bliss/core";
import type { FastifyInstance } from "fastify";
import router from "./router";
import { RequestsService } from "./services/RequestsService";

export const SERVICE_NAME = "bliss-requests";

export function buildApp(): Promise<FastifyInstance> {
	return createApp({
		serviceName: SERVICE_NAME,
		description: "Abertura e consulta de solicitações (tickets).",
		router,
		tags: [{ name: "requests", description: "Solicitações" }],
		// O `/health` deste serviço verifica o banco de fato: um healthcheck que
		// não toca a dependência crítica reporta saudável enquanto toda requisição
		// real falha.
		healthProbe: () => new RequestsService().checkDatabase(),
	});
}

/** Handler consumido pela AWS Lambda (`dist/app.lambdaHandler`). */
export const lambdaHandler = createLambdaHandler(buildApp);

export default buildApp;
