/**
 * @module bliss-auth/app
 *
 * Microserviço de autenticação — emite os tokens que o `bliss-authorizer` valida.
 *
 * Domínio separado dos demais pelo perfil oposto: é chamado uma vez por sessão e
 * faz trabalho **caro de propósito** — a derivação da senha leva ~100ms, e é
 * justamente esse custo que torna força bruta impraticável. Misturá-lo a um
 * serviço de leitura obrigaria a dimensionar os dois pelo pior caso.
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
