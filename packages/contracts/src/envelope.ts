/**
 * @module contracts/envelope
 *
 * Envelope de resposta da API. Vive em `contracts` — e não em `apps/api` —
 * porque o interceptor do backoffice e o cliente HTTP da automação precisam
 * desembrulhar exatamente a mesma forma. Quando a API muda o envelope, o build
 * dos consumidores quebra na hora certa.
 */

import { z } from "zod";

/** Códigos de erro do domínio. O catálogo da API mapeia cada um para um status HTTP. */
export const ERROR_CODES = [
	"VALIDATION_ERROR",
	"REQUEST_NOT_FOUND",
	"INVALID_STATUS_TRANSITION",
	"REQUEST_ALREADY_REVIEWED",
	"DATABASE_UNAVAILABLE",
	"INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiErrorDetailSchema = z.object({
	code: z.string(),
	message: z.string(),
	details: z.unknown().optional(),
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/**
 * `requestId` está no envelope de sucesso *e* no de erro, e também vai no header
 * `x-request-id`. Redundância deliberada: uma resposta de erro é justamente o
 * momento em que alguém precisa correlacionar com o log, e nem todo cliente
 * expõe headers de resposta com facilidade.
 */
export const SuccessEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
	message: z.string().optional(),
	requestId: z.string(),
	timestamp: z.string().datetime(),
});

export const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: ApiErrorDetailSchema,
	requestId: z.string(),
	timestamp: z.string().datetime(),
});

export const EnvelopeSchema = z.discriminatedUnion("success", [SuccessEnvelopeSchema, ErrorEnvelopeSchema]);

/** Envelope de sucesso tipado pelo payload que carrega. */
export type SuccessEnvelope<TData> = {
	success: true;
	data: TData;
	message?: string;
	requestId: string;
	timestamp: string;
};

export type ErrorEnvelope = {
	success: false;
	error: ApiErrorDetail;
	requestId: string;
	timestamp: string;
};

export type Envelope<TData> = SuccessEnvelope<TData> | ErrorEnvelope;

/** Type guard para estreitar o envelope no lado do consumidor. */
export function isSuccessEnvelope<TData>(envelope: Envelope<TData>): envelope is SuccessEnvelope<TData> {
	return envelope.success === true;
}

/** Nome do header que carrega o id de correlação em toda a cadeia. */
export const REQUEST_ID_HEADER = "x-request-id";
