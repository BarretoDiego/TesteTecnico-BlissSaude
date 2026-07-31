/**
 * @module api/middlewares/GetRequestMiddleware
 *
 * `GET /requests/{id}` — validação do parâmetro de rota.
 */

import { DefaultErroHandler } from "@/errors/DefaultErroHandler";
import { toJsonSchema } from "@/utils/jsonSchema";
import { buildErrorResponseSchema } from "@/utils/responseEnvelope";
import { RequestDetailSchema, RequestIdParamsSchema } from "@saude-bliss/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const GetRequestParamsSchema = RequestIdParamsSchema;
export type TGetRequestParams = z.infer<typeof GetRequestParamsSchema>;

export const GetRequestResponseSchema = z.object({
	success: z.literal(true),
	data: RequestDetailSchema,
	requestId: z.string(),
	timestamp: z.string(),
});

export type TGetRequestFastifyRequest = {
	Params: TGetRequestParams;
};

/**
 * Valida que o `id` é um UUID.
 *
 * Rejeitar aqui significa 400 para um id malformado e 404 apenas para um UUID
 * válido inexistente — a distinção que o cliente precisa para saber se erro foi
 * dele ou se o recurso sumiu. Sem a checagem, o Postgres devolveria erro de
 * sintaxe de tipo e o handler traduziria para 500.
 */
export const GetRequestMiddleware = async (
	req: FastifyRequest<TGetRequestFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.params = GetRequestParamsSchema.parse(req.params);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "GetRequestMiddleware", action: "validate" });
	}
};

export const GetRequestSchema = {
	tags: ["requests"],
	summary: "Consulta uma solicitação por id",
	description: "Retorna a solicitação e sua linha do tempo de eventos. Responde 404 quando o id não existe.",
	params: toJsonSchema(GetRequestParamsSchema),
	response: {
		200: toJsonSchema(GetRequestResponseSchema),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		404: buildErrorResponseSchema(["REQUEST_NOT_FOUND"]),
		500: buildErrorResponseSchema(["INTERNAL_ERROR"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
