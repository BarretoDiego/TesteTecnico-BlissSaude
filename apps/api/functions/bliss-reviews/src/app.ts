/**
 * @module bliss-reviews/app
 *
 * Microserviço de conferência — revisão operacional e trilha de auditoria.
 *
 * Domínio separado do de solicitações de propósito: os atores são outros
 * (conferente, não solicitante), o perfil de carga é outro (rajadas na
 * conferência diária, não fluxo contínuo) e a criticidade é outra. Separar
 * significa que uma fila de conferência pesada não consome a concorrência de
 * quem está abrindo solicitação.
 */

import { createApp, createLambdaHandler } from "@saude-bliss/core";
import type { FastifyInstance } from "fastify";
import router from "./router";
import { ReviewsService } from "./services/ReviewsService";

export const SERVICE_NAME = "bliss-reviews";

export function buildApp(): Promise<FastifyInstance> {
	return createApp({
		serviceName: SERVICE_NAME,
		description: "Conferência operacional de solicitações e trilha de auditoria.",
		router,
		tags: [{ name: "reviews", description: "Conferência" }],
		healthProbe: () => new ReviewsService().checkDatabase(),
	});
}

/** Handler consumido pela AWS Lambda (`dist/app.lambdaHandler`). */
export const lambdaHandler = createLambdaHandler(buildApp);

export default buildApp;
