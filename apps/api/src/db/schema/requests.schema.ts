/**
 * @module api/db/schema/requests
 *
 * Tabela de solicitações e sua trilha de auditoria.
 *
 * Nomenclatura: a coluna de correlação chama-se `trace_id`, não `request_id`.
 * A entidade já se chama *request*, então `requests.request_id` seria ambíguo e
 * colidiria com a FK em `request_events`. No HTTP o campo continua `requestId`,
 * que é o contrato da casa. Ver docs/adr/0003-requestid-traceability.md.
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { requestEventTypeEnum, requestPriorityEnum, requestStatusEnum } from "./enums.schema";

export const requests = pgTable(
	"requests",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		title: varchar("title", { length: 140 }).notNull(),
		description: text("description").notNull(),
		/** Sem default: o desafio determina que o cliente informe a prioridade. */
		priority: requestPriorityEnum("priority").notNull(),
		/** Sempre `open` na criação — campo do servidor, nunca aceito no payload. */
		status: requestStatusEnum("status").notNull().default("open"),
		/** Guardado em minúsculas: é chave de filtro em `?createdBy=`. */
		createdBy: varchar("created_by", { length: 160 }).notNull(),
		reviewedBy: varchar("reviewed_by", { length: 160 }),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		/** Id de correlação do POST que criou a linha — liga o registro ao log. */
		createdTraceId: varchar("created_trace_id", { length: 64 }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Listagem sem filtro, ordenada por mais recente.
		index("idx_requests_created_at").on(table.createdAt.desc()),
		// `?createdBy=` — o `created_at` no índice evita sort depois do filtro.
		index("idx_requests_created_by_created_at").on(table.createdBy, table.createdAt.desc()),
		// `?status=` isolado. Tecnicamente redundante com o composto abaixo pelo
		// prefixo mais à esquerda, mas estritamente mais estreito, o que mantém a
		// consulta mais comum da tela de conferência barata.
		index("idx_requests_status_created_at").on(table.status, table.createdAt.desc()),
		// `?status=&createdBy=` combinados.
		index("idx_requests_status_created_by_created_at").on(table.status, table.createdBy, table.createdAt.desc()),
		// Busca reversa: "que linha esta requisição criou?"
		index("idx_requests_created_trace_id").on(table.createdTraceId),
	]
);

export const requestEvents = pgTable(
	"request_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		requestId: uuid("request_id")
			.notNull()
			.references(() => requests.id, { onDelete: "cascade" }),
		type: requestEventTypeEnum("type").notNull(),
		fromStatus: requestStatusEnum("from_status"),
		toStatus: requestStatusEnum("to_status").notNull(),
		actor: varchar("actor", { length: 160 }),
		traceId: varchar("trace_id", { length: 64 }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("idx_request_events_request_id_created_at").on(table.requestId, table.createdAt.desc()),
		index("idx_request_events_trace_id").on(table.traceId),
	]
);

export const requestsRelations = relations(requests, ({ many }) => ({
	events: many(requestEvents),
}));

export const requestEventsRelations = relations(requestEvents, ({ one }) => ({
	request: one(requests, {
		fields: [requestEvents.requestId],
		references: [requests.id],
	}),
}));

export type RequestRow = typeof requests.$inferSelect;
export type NewRequestRow = typeof requests.$inferInsert;
export type RequestEventRow = typeof requestEvents.$inferSelect;
export type NewRequestEventRow = typeof requestEvents.$inferInsert;
