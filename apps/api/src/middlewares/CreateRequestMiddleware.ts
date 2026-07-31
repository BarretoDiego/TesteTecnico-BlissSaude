/**
 * @module api/middlewares/CreateRequestMiddleware
 *
 * `POST /requests` — validação de entrada e schema de documentação.
 */

import { DefaultErroHandler } from "@/errors/DefaultErroHandler";
import { toJsonSchema } from "@/utils/jsonSchema";
import { buildErrorResponseSchema } from "@/utils/responseEnvelope";
import { CreateRequestPayloadSchema, RequestSchema } from "@saude-bliss/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const CreateRequestBodySchema = CreateRequestPayloadSchema;
export type TCreateRequestBody = z.infer<typeof CreateRequestBodySchema>;

export const CreateRequestResponseSchema = z.object({
	success: z.literal(true),
	data: RequestSchema,
	message: z.string().optional(),
	requestId: z.string(),
	timestamp: z.string(),
});

export type TCreateRequestFastifyRequest = {
	Body: TCreateRequestBody;
};

/**
 * Valida e normaliza o corpo.
 *
 * A reatribuição de `req.body` não é cosmética: é ela que propaga as
 * transformações do Zod — `trim` no título e `toLowerCase` no `createdBy` — para
 * o controller. Sem isso, o `createdBy` chegaria ao banco com a caixa original e
 * o filtro `?createdBy=` passaria a errar.
 */
export const CreateRequestMiddleware = async (
	req: FastifyRequest<TCreateRequestFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.body = CreateRequestBodySchema.parse(req.body);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "CreateRequestMiddleware", action: "validate" });
	}
};

/** Schema da rota para o Fastify e o Swagger. */
export const CreateRequestSchema = {
	tags: ["requests"],
	summary: "Cria uma solicitação",
	description:
		"Cria uma nova solicitação. O status inicial é sempre `open` e não pode ser informado no payload. " +
		"O `requestId` da resposta é persistido junto à solicitação, permitindo rastrear a criação nos logs.",
	body: toJsonSchema(CreateRequestBodySchema),
	response: {
		201: toJsonSchema(CreateRequestResponseSchema),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		500: buildErrorResponseSchema(["INTERNAL_ERROR"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
