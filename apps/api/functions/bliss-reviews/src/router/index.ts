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

/** Rotas expostas por este microserviço, relativas ao prefixo. */
export const ROUTES: readonly RouteDescriptor[] = [
	{ method: "PATCH", path: "/requests/:id/review" },
	{ method: "GET", path: "/requests/:id/timeline" },
];

export default async function router(app: FastifyInstance, options: RouterOptions): Promise<void> {
	app.route({
		method: "PATCH",
		url: "/requests/:id/review",
		schema: ReviewRequestSchema,
		preValidation: [ReviewRequestMiddleware],
		handler: ReviewsController.review,
	});

	app.route({
		method: "GET",
		url: "/requests/:id/timeline",
		schema: GetTimelineSchema,
		preValidation: [GetTimelineMiddleware],
		handler: ReviewsController.getTimeline,
	});

	describeRoutes(app, options, ROUTES);
}
