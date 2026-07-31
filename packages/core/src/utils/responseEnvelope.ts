/**
 * @module api/utils/responseEnvelope
 *
 * Montagem do envelope de resposta.
 *
 * Toda resposta da API — sucesso ou erro — passa por aqui, o que garante que
 * `requestId` e `timestamp` nunca sejam esquecidos em um endpoint novo.
 */

import { REQUEST_ID_HEADER, type ApiErrorDetail, type ErrorCode } from "@saude-bliss/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getRequestId } from "./requestContext";

/**
 * Resolve o id de correlação com três fontes em cascata.
 *
 * O ALS é a fonte canônica, mas o fallback existe para o caso de uma resposta
 * ser emitida fora do escopo do contexto (ex.: `onError` disparado antes do hook
 * `onRequest` completar). Melhor um id do `req` do que nenhum id.
 */
export function resolveRequestId(req: FastifyRequest): string {
	return getRequestId() ?? req.id ?? (req.headers[REQUEST_ID_HEADER] as string) ?? "unknown";
}

interface SuccessOptions<TData> {
	data: TData;
	statusCode?: number;
	message?: string;
}

/** Resposta de sucesso no envelope padrão. */
export function blissSuccess<TData>(
	res: FastifyReply,
	req: FastifyRequest,
	options: SuccessOptions<TData>
): FastifyReply {
	const requestId = resolveRequestId(req);
	return res
		.code(options.statusCode ?? 200)
		.header(REQUEST_ID_HEADER, requestId)
		.send({
			success: true,
			data: options.data,
			...(options.message ? { message: options.message } : {}),
			requestId,
			timestamp: new Date().toISOString(),
		});
}

/** Resposta de erro no envelope padrão. */
export function blissFail(
	res: FastifyReply,
	req: FastifyRequest,
	statusCode: number,
	error: ApiErrorDetail
): FastifyReply {
	const requestId = resolveRequestId(req);
	return res.code(statusCode).header(REQUEST_ID_HEADER, requestId).send({
		success: false,
		error,
		requestId,
		timestamp: new Date().toISOString(),
	});
}

/** Schema JSON do envelope de erro, para o Swagger. */
export function buildErrorResponseSchema(codes: readonly ErrorCode[]) {
	return {
		type: "object",
		required: ["success", "error", "requestId", "timestamp"],
		properties: {
			success: { type: "boolean", enum: [false] },
			error: {
				type: "object",
				required: ["code", "message"],
				properties: {
					code: { type: "string", enum: [...codes] },
					message: { type: "string" },
					details: {},
				},
			},
			requestId: { type: "string" },
			timestamp: { type: "string", format: "date-time" },
		},
	} as const;
}
