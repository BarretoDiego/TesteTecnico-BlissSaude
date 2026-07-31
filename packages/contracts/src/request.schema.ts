/**
 * @module contracts/request.schema
 *
 * Schemas Zod do domínio de solicitações. São a fronteira compartilhada: a API
 * valida entrada com eles, o backoffice tipa suas chamadas com eles e a suíte
 * Playwright monta payloads com eles. Uma mudança aqui quebra o build de quem
 * ficou para trás, que é exatamente o efeito desejado.
 */

import { z } from "zod";
import { REQUEST_EVENT_TYPES, REQUEST_PRIORITIES, REQUEST_STATUSES } from "./enums";

export const RequestPrioritySchema = z.enum(REQUEST_PRIORITIES);
export const RequestStatusSchema = z.enum(REQUEST_STATUSES);
export const RequestEventTypeSchema = z.enum(REQUEST_EVENT_TYPES);

/**
 * Identificador de quem abriu ou conferiu a solicitação.
 *
 * Normalizado para minúsculas porque é chave de filtro (`?createdBy=`): sem isso,
 * "Ana@x.com" e "ana@x.com" viram dois solicitantes distintos na listagem.
 */
export const ActorSchema = z
	.string({ required_error: "Informe o identificador do solicitante" })
	.trim()
	.min(3, "Identificador do solicitante deve ter ao menos 3 caracteres")
	.max(160, "Identificador do solicitante deve ter no máximo 160 caracteres")
	.email("Identificador do solicitante deve ser um e-mail válido")
	.toLowerCase();

export const RequestTitleSchema = z
	.string({ required_error: "Informe o título da solicitação" })
	.trim()
	.min(3, "Título deve ter ao menos 3 caracteres")
	.max(140, "Título deve ter no máximo 140 caracteres");

export const RequestDescriptionSchema = z
	.string({ required_error: "Informe a descrição da solicitação" })
	.trim()
	.min(10, "Descrição deve ter ao menos 10 caracteres")
	.max(5000, "Descrição deve ter no máximo 5000 caracteres");

// -----------------------------------------------------------------------------
// Entidades
// -----------------------------------------------------------------------------

/**
 * Solicitação como sai da API.
 *
 * `createdTraceId` é exposto de propósito: é o elo que liga a linha do banco ao
 * `requestId` do envelope e às linhas de log no CloudWatch.
 */
export const RequestSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	description: z.string(),
	priority: RequestPrioritySchema,
	status: RequestStatusSchema,
	createdBy: z.string(),
	reviewedBy: z.string().nullable(),
	reviewedAt: z.string().datetime().nullable(),
	createdTraceId: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type Request = z.infer<typeof RequestSchema>;

export const RequestEventSchema = z.object({
	id: z.string().uuid(),
	requestId: z.string().uuid(),
	type: RequestEventTypeSchema,
	fromStatus: RequestStatusSchema.nullable(),
	toStatus: RequestStatusSchema,
	actor: z.string().nullable(),
	traceId: z.string().nullable(),
	createdAt: z.string().datetime(),
});
export type RequestEvent = z.infer<typeof RequestEventSchema>;

// -----------------------------------------------------------------------------
// Payloads de entrada
// -----------------------------------------------------------------------------

/**
 * Corpo de `POST /requests`.
 *
 * `.strict()` para que um campo desconhecido — tipicamente alguém tentando
 * mandar `status` — falhe alto em vez de ser ignorado em silêncio.
 */
export const CreateRequestPayloadSchema = z
	.object({
		title: RequestTitleSchema,
		description: RequestDescriptionSchema,
		priority: RequestPrioritySchema,
		createdBy: ActorSchema,
	})
	.strict();
export type CreateRequestPayload = z.infer<typeof CreateRequestPayloadSchema>;

/** Corpo de `PATCH /requests/{id}/review`. */
export const ReviewRequestPayloadSchema = z
	.object({
		reviewedBy: ActorSchema,
		status: z.enum(["reviewed", "rejected"], {
			errorMap: () => ({ message: "Status de conferência deve ser 'reviewed' ou 'rejected'" }),
		}),
		note: z.string().trim().max(500, "Observação deve ter no máximo 500 caracteres").optional(),
	})
	.strict();
export type ReviewRequestPayload = z.infer<typeof ReviewRequestPayloadSchema>;

/**
 * Filtro de status: um valor ou vários separados por vírgula.
 *
 * A entrada é **string** de propósito. O Fastify valida a query string contra o
 * JSON Schema da rota antes de qualquer middleware, e `zodToJsonSchema` de um
 * `transform` emite o lado de entrada — então declarar `z.string()` aqui é o que
 * faz `?status=open,in_review` sobreviver à borda. Um `z.enum` emitiria uma lista
 * fechada, e a forma composta seria rejeitada antes de chegar à validação real.
 *
 * `?status=open` continua funcionando: um valor só é lista de um elemento.
 */
export const RequestStatusFilterSchema = z
	.string()
	.describe(`Um status ou vários separados por vírgula (${REQUEST_STATUSES.join(", ")})`)
	.transform((value, ctx) => {
		const parts = value
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);

		const parsed = z.array(RequestStatusSchema).min(1).safeParse(parts);
		if (!parsed.success) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Status deve ser um ou mais de: ${REQUEST_STATUSES.join(", ")}`,
			});
			return z.NEVER;
		}
		return parsed.data;
	});

/**
 * Query string de `GET /requests`.
 *
 * `page`/`pageSize` usam `coerce` porque query string sempre chega como texto.
 * O teto de 100 em `pageSize` existe para que um `?pageSize=100000` não vire um
 * table scan que derruba o pool de conexões da Lambda.
 */
export const ListRequestsQueryPayloadSchema = z
	.object({
		createdBy: ActorSchema.optional(),
		status: RequestStatusFilterSchema.optional(),
		priority: RequestPrioritySchema.optional(),
		page: z.coerce.number().int().min(1, "Página deve ser maior ou igual a 1").default(1),
		pageSize: z.coerce
			.number()
			.int()
			.min(1, "Tamanho de página deve ser maior ou igual a 1")
			.max(100, "Tamanho de página deve ser no máximo 100")
			.default(20),
	})
	.strict();
/** Query **depois** de validada — é o que service e repositório recebem. */
export type ListRequestsQueryPayload = z.infer<typeof ListRequestsQueryPayloadSchema>;

/**
 * Query como o cliente a monta, antes da validação.
 *
 * Difere da de saída em `status` (string na entrada, lista na saída) e em
 * `page`/`pageSize`, opcionais aqui e com default do outro lado. Quem chama a
 * API tipa por este; quem a implementa, pelo de cima.
 */
export type ListRequestsQueryInput = z.input<typeof ListRequestsQueryPayloadSchema>;

/** Parâmetro de rota compartilhado por `GET /requests/{id}` e `PATCH .../review`. */
export const RequestIdParamsSchema = z
	.object({
		id: z.string().uuid("Identificador da solicitação deve ser um UUID válido"),
	})
	.strict();
export type RequestIdParams = z.infer<typeof RequestIdParamsSchema>;

// -----------------------------------------------------------------------------
// Payloads de saída
// -----------------------------------------------------------------------------

export const PaginationSchema = z.object({
	page: z.number().int(),
	pageSize: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const ListRequestsResultSchema = z.object({
	items: z.array(RequestSchema),
	pagination: PaginationSchema,
});
export type ListRequestsResult = z.infer<typeof ListRequestsResultSchema>;

/** Detalhe traz a linha do tempo — é o que sustenta a tela de conferência. */
export const RequestDetailSchema = RequestSchema.extend({
	events: z.array(RequestEventSchema),
});
export type RequestDetail = z.infer<typeof RequestDetailSchema>;
