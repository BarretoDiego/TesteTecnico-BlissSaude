/**
 * @module bliss-requests/app
 *
 * Microserviço de solicitações — abertura e consulta.
 *
 * Uma Lambda por domínio: todas as rotas de solicitações vivem nesta função e
 * escalam, fazem deploy e são observadas como uma unidade. Toda a plataforma
 * (contexto de requisição, envelope, CORS, `/health`, adaptador Lambda) vem da
 * factory compartilhada, e o que é deste domínio vem de `./service` — a mesma
 * definição que o modo agregado consome.
 */

import { createApp, createLambdaHandler } from "@saude-bliss/core";
import type { FastifyInstance } from "fastify";
import { service } from "./service";

export const SERVICE_NAME = service.name;

export function buildApp(): Promise<FastifyInstance> {
	return createApp(service);
}

/** Handler consumido pela AWS Lambda (`dist/app.lambdaHandler`). */
export const lambdaHandler = createLambdaHandler(buildApp);

export default buildApp;
