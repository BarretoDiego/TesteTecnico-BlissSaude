/**
 * @module contracts/enums
 *
 * Fonte única dos enums do domínio.
 *
 * Os arrays literais aqui alimentam três consumidores que precisam concordar:
 * o `pgEnum` do Drizzle, os `z.enum` de validação e os filtros do backoffice.
 * Declarar em qualquer outro lugar cria cópias que divergem silenciosamente na
 * primeira vez que alguém adiciona um status.
 */

/** Prioridade informada por quem abre a solicitação. */
export const REQUEST_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/**
 * Ciclo de vida da solicitação. Sempre nasce em `open` — o cliente nunca
 * informa status na criação, é dado do servidor.
 */
export const REQUEST_STATUSES = ["open", "in_review", "reviewed", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Transições permitidas. Ficam aqui (e não no service) para que backoffice e
 * automação possam desabilitar ações impossíveis sem duplicar a regra.
 */
export const REQUEST_STATUS_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
	open: ["in_review", "reviewed", "rejected"],
	in_review: ["reviewed", "rejected"],
	reviewed: [],
	rejected: [],
};

/** `true` se a solicitação ainda pode mudar de estado. */
export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
	return REQUEST_STATUS_TRANSITIONS[from].includes(to);
}

/** Estados que ainda entram na fila de conferência diária. */
export const PENDING_REVIEW_STATUSES = ["open", "in_review"] as const satisfies readonly RequestStatus[];

/** Tipos de evento registrados na trilha de auditoria. */
export const REQUEST_EVENT_TYPES = ["created", "status_changed", "reviewed"] as const;
export type RequestEventType = (typeof REQUEST_EVENT_TYPES)[number];

/** Rótulos PT-BR para exibição — evita `switch` de tradução espalhado pelo front. */
export const REQUEST_STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
	open: "Aberta",
	in_review: "Em conferência",
	reviewed: "Revisada",
	rejected: "Rejeitada",
};

export const REQUEST_PRIORITY_LABELS: Readonly<Record<RequestPriority, string>> = {
	low: "Baixa",
	medium: "Média",
	high: "Alta",
	critical: "Crítica",
};
