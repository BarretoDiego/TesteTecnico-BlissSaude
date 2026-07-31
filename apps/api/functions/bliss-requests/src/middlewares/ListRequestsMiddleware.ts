/**
 * @module api/middlewares/ListRequestsMiddleware
 *
 * `GET /requests?createdBy=&status=` — validação e normalização dos filtros.
 */

import { ListRequestsQueryPayloadSchema, ListRequestsResultSchema } from "@saude-bliss/contracts";
import { buildErrorResponseSchema, DefaultErroHandler, toJsonSchema } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const ListRequestsQuerySchema = ListRequestsQueryPayloadSchema;
export type TListRequestsQuery = z.infer<typeof ListRequestsQuerySchema>;

export const ListRequestsResponseSchema = z.object({
	success: z.literal(true),
	data: ListRequestsResultSchema,
	requestId: z.string(),
	timestamp: z.string(),
});

export type TListRequestsFastifyRequest = {
	Querystring: TListRequestsQuery;
};

/**
 * Valida a query string.
 *
 * Registrado como `preHandler` — e não `preValidation` como os demais — porque
 * este schema **muda o tipo** dos valores: `page` e `pageSize` chegam como texto
 * e saem como número via `z.coerce`. Em `preValidation` o Fastify ainda
 * revalidaria contra o JSON Schema depois, rejeitando o número recém-convertido.
 */
export const ListRequestsMiddleware = async (
	req: FastifyRequest<TListRequestsFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.query = ListRequestsQuerySchema.parse(req.query ?? {});
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "ListRequestsMiddleware", action: "validate" });
	}
};

export const ListRequestsSchema = {
	tags: ["requests"],
	summary: "Lista solicitações com filtros",
	description:
		"Lista solicitações ordenadas da mais recente para a mais antiga. " +
		"Os filtros `createdBy`, `status` e `priority` são opcionais e combináveis.",
	querystring: toJsonSchema(ListRequestsQuerySchema),
	response: {
		200: toJsonSchema(ListRequestsResponseSchema),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		500: buildErrorResponseSchema(["INTERNAL_ERROR"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
