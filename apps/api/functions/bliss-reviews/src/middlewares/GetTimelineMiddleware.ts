/**
 * @module bliss-reviews/middlewares/GetTimelineMiddleware
 *
 * `GET /requests/{id}/timeline` — validação do parâmetro de rota.
 */

import { RequestDetailSchema, RequestIdParamsSchema } from "@saude-bliss/contracts";
import { buildErrorResponseSchema, DefaultErroHandler, toJsonSchema } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const GetTimelineParamsSchema = RequestIdParamsSchema;
export type TGetTimelineParams = z.infer<typeof GetTimelineParamsSchema>;

export const GetTimelineResponseSchema = z.object({
	success: z.literal(true),
	data: RequestDetailSchema,
	requestId: z.string(),
	timestamp: z.string(),
});

export type TGetTimelineFastifyRequest = {
	Params: TGetTimelineParams;
};

/**
 * Valida que o `id` é um UUID.
 *
 * Rejeitar aqui significa 400 para um id malformado e 404 apenas para um UUID
 * válido inexistente — a distinção que o cliente precisa para saber se o erro
 * foi dele ou se o recurso sumiu.
 */
export const GetTimelineMiddleware = async (
	req: FastifyRequest<TGetTimelineFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.params = GetTimelineParamsSchema.parse(req.params);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "GetTimelineMiddleware", action: "validate" });
	}
};

export const GetTimelineSchema = {
	tags: ["reviews"],
	summary: "Consulta a trilha de auditoria de uma solicitação",
	description:
		"Retorna a solicitação e todos os eventos registrados, do mais recente para o mais antigo. " +
		"Cada evento carrega o `traceId` da requisição que o produziu.",
	params: toJsonSchema(GetTimelineParamsSchema),
	response: {
		200: toJsonSchema(GetTimelineResponseSchema),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		404: buildErrorResponseSchema(["REQUEST_NOT_FOUND"]),
		500: buildErrorResponseSchema(["INTERNAL_ERROR"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
