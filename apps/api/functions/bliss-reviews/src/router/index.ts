/**
 * @module bliss-reviews/router
 *
 * Tabela de rotas do domínio de conferência.
 *
 * Declara **apenas** o mapeamento rota → schema → middleware → handler.
 */

import type { FastifyInstance } from "fastify";
import ReviewsController from "../controllers/ReviewsController";
import { GetTimelineMiddleware, GetTimelineSchema } from "../middlewares/GetTimelineMiddleware";
import { ReviewRequestMiddleware, ReviewRequestSchema } from "../middlewares/ReviewRequestMiddleware";

export default async function router(app: FastifyInstance): Promise<void> {
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
}
