/**
 * @module api/middlewares/ReviewRequestMiddleware
 *
 * `PATCH /requests/{id}/review` — validação da conferência.
 *
 * Endpoint além do escopo mínimo do desafio. Existe porque a automação de
 * conferência precisa de uma ação de escrita para ser um fluxo operacional de
 * verdade, e não um roteiro de cliques. Justificado no README.
 */

import { RequestIdParamsSchema, RequestSchema, ReviewRequestPayloadSchema } from "@saude-bliss/contracts";
import { buildErrorResponseSchema, DefaultErroHandler, toJsonSchema } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const ReviewRequestParamsSchema = RequestIdParamsSchema;
export const ReviewRequestBodySchema = ReviewRequestPayloadSchema;
export type TReviewRequestParams = z.infer<typeof ReviewRequestParamsSchema>;
export type TReviewRequestBody = z.infer<typeof ReviewRequestBodySchema>;

export const ReviewRequestResponseSchema = z.object({
	success: z.literal(true),
	data: RequestSchema,
	message: z.string().optional(),
	requestId: z.string(),
	timestamp: z.string(),
});

export type TReviewRequestFastifyRequest = {
	Params: TReviewRequestParams;
	Body: TReviewRequestBody;
};

export const ReviewRequestMiddleware = async (
	req: FastifyRequest<TReviewRequestFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.params = ReviewRequestParamsSchema.parse(req.params);
		req.body = ReviewRequestBodySchema.parse(req.body);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "ReviewRequestMiddleware", action: "validate" });
	}
};

export const ReviewRequestSchema = {
	tags: ["reviews"],
	summary: "Registra a conferência de uma solicitação",
	description:
		"Marca a solicitação como `reviewed` ou `rejected` e registra o evento na trilha de auditoria. " +
		"Responde 409 quando a solicitação já foi conferida ou quando a transição não é permitida.",
	params: toJsonSchema(ReviewRequestParamsSchema),
	body: toJsonSchema(ReviewRequestBodySchema),
	response: {
		200: toJsonSchema(ReviewRequestResponseSchema),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		404: buildErrorResponseSchema(["REQUEST_NOT_FOUND"]),
		409: buildErrorResponseSchema(["REQUEST_ALREADY_REVIEWED", "INVALID_STATUS_TRANSITION"]),
		500: buildErrorResponseSchema(["INTERNAL_ERROR"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
