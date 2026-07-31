/**
 * @module bliss-reviews/router
 *
 * Tabela de rotas do domínio de conferência.
 *
 * Declara **apenas** o mapeamento rota → schema → middleware → handler. Recebe o
 * prefixo sob o qual está sendo montado, o que torna o agrupamento do
 * microserviço explícito aqui em vez de escondido no chamador.
 */

import { describeRoutes, type RouteDescriptor, type RouterOptions } from "@saude-bliss/core";
import type { FastifyInstance } from "fastify";
import ReviewsController from "../controllers/ReviewsController";
import { GetTimelineMiddleware, GetTimelineSchema } from "../middlewares/GetTimelineMiddleware";
import { ReviewRequestMiddleware, ReviewRequestSchema } from "../middlewares/ReviewRequestMiddleware";

/**
 * Prefixo do domínio. Distinto do de `bliss-requests` de propósito: se as duas
 * Lambdas dividissem `/requests`, o API Gateway precisaria de uma regra por
 * método para decidir qual invocar, e cada rota nova exigiria mexer no
 * roteamento da infraestrutura.
 *
 * O `:id` das rotas é o id da **solicitação** sendo conferida — a conferência é
 * um recurso singular por solicitação, então ela não tem id próprio.
 */
export const ROUTE_PREFIX = "/reviews";

/** Rotas expostas, relativas ao prefixo. */
export const ROUTES: readonly RouteDescriptor[] = [
	{ method: "PATCH", path: "/:id" },
	{ method: "GET", path: "/:id/timeline" },
];

export default async function router(app: FastifyInstance, options: RouterOptions): Promise<void> {
	app.route({
		method: "PATCH",
		url: "/:id",
		schema: ReviewRequestSchema,
		preValidation: [ReviewRequestMiddleware],
		handler: ReviewsController.review,
	});

	app.route({
		method: "GET",
		url: "/:id/timeline",
		schema: GetTimelineSchema,
		preValidation: [GetTimelineMiddleware],
		handler: ReviewsController.getTimeline,
	});

	describeRoutes(app, options, ROUTES);
}
