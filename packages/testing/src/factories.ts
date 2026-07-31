/**
 * @module testing/factories
 *
 * Construtores de dados de teste.
 *
 * Cada factory devolve um objeto válido por padrão e aceita sobrescrita parcial.
 * O ganho é que um teste declara apenas o que é relevante para ele — quando um
 * campo obrigatório novo entra no schema, só a factory muda, não os 40 testes.
 */

import type {
	CreateRequestPayload,
	ListRequestsQueryPayload,
	RequestDetail,
	Request as RequestDto,
	RequestEvent,
	ReviewRequestPayload,
} from "@saude-bliss/contracts";

let sequence = 0;

/** UUID determinístico e único por chamada — evita colisão sem `Math.random`. */
export function makeUuid(seed = ++sequence): string {
	const hex = seed.toString(16).padStart(12, "0");
	return `00000000-0000-4000-8000-${hex}`;
}

export function makeCreatePayload(overrides: Partial<CreateRequestPayload> = {}): CreateRequestPayload {
	return {
		title: "Beneficiária sem acesso ao aplicativo",
		description: "Login retorna erro após a troca de senha pelo portal web.",
		priority: "high",
		createdBy: "ana.souza@saudebliss.test",
		...overrides,
	};
}

export function makeReviewPayload(overrides: Partial<ReviewRequestPayload> = {}): ReviewRequestPayload {
	return { reviewedBy: "daniel.morais@saudebliss.test", status: "reviewed", ...overrides };
}

export function makeRequest(overrides: Partial<RequestDto> = {}): RequestDto {
	const now = "2026-07-30T12:00:00.000Z";
	return {
		id: makeUuid(),
		title: "Beneficiária sem acesso ao aplicativo",
		description: "Login retorna erro após a troca de senha pelo portal web.",
		priority: "high",
		status: "open",
		createdBy: "ana.souza@saudebliss.test",
		reviewedBy: null,
		reviewedAt: null,
		createdTraceId: "trace-teste",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

export function makeEvent(overrides: Partial<RequestEvent> = {}): RequestEvent {
	return {
		id: makeUuid(),
		requestId: makeUuid(),
		type: "created",
		fromStatus: null,
		toStatus: "open",
		actor: "ana.souza@saudebliss.test",
		traceId: "trace-teste",
		createdAt: "2026-07-30T12:00:00.000Z",
		...overrides,
	};
}

export function makeRequestDetail(overrides: Partial<RequestDetail> = {}): RequestDetail {
	const request = makeRequest(overrides);
	return { ...request, events: [makeEvent({ requestId: request.id })], ...overrides };
}

/** Query já com os defaults que o Zod aplicaria. */
export function makeListQuery(overrides: Partial<ListRequestsQueryPayload> = {}): ListRequestsQueryPayload {
	return { page: 1, pageSize: 20, ...overrides };
}
