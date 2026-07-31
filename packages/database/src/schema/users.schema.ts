/**
 * @module database/schema/users
 *
 * Usuários e sessões de refresh.
 *
 * O hash da senha vive aqui e **nunca** sai do serviço de autenticação: nenhum
 * mapper o expõe, e o DTO público (`AuthenticatedUser`) não tem o campo. Um
 * `select *` que vaze o hash para uma resposta é o tipo de acidente que só
 * aparece em auditoria, então a defesa é o campo não existir no tipo de saída.
 */

import { USER_ROLES } from "@saude-bliss/contracts";
import { relations } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", USER_ROLES);

export const users = pgTable(
	"users",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		email: varchar("email", { length: 160 }).notNull(),
		name: varchar("name", { length: 160 }).notNull(),
		/**
		 * Formato `scrypt$N$r$p$salt$hash`, com salt por usuário.
		 *
		 * Os parâmetros ficam **dentro** do hash, não em constante do código: é o
		 * que permite endurecê-los no futuro sem invalidar as senhas existentes —
		 * cada linha é verificada com os parâmetros que a geraram.
		 */
		passwordHash: varchar("password_hash", { length: 512 }).notNull(),
		roles: userRoleEnum("roles").array().notNull().default([]),
		/** Desativar preserva a trilha de auditoria; excluir a apagaria. */
		active: boolean("active").notNull().default(true),
		lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Único: o e-mail é a credencial de login, e duplicá-lo tornaria o
		// resultado da autenticação dependente da ordem das linhas.
		uniqueIndex("idx_users_email").on(table.email),
		index("idx_users_active").on(table.active),
	]
);

export const refreshTokens = pgTable(
	"refresh_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/**
		 * SHA-256 do token, nunca o token.
		 *
		 * Vazamento de banco não pode virar sequestro de sessão. Diferente da senha,
		 * não precisa de KDF lento: o token é aleatório de 256 bits, então não há
		 * espaço de busca que força bruta consiga percorrer.
		 */
		tokenHash: varchar("token_hash", { length: 64 }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		/** Preenchido na rotação ou no logout — o token deixa de valer sem sumir. */
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		/** Token que substituiu este na rotação. Permite detectar reuso. */
		replacedByHash: varchar("replaced_by_hash", { length: 64 }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// A consulta do refresh é sempre pelo hash — precisa ser única e indexada.
		uniqueIndex("idx_refresh_tokens_hash").on(table.tokenHash),
		index("idx_refresh_tokens_user_id").on(table.userId),
		// Suporta a limpeza periódica dos expirados.
		index("idx_refresh_tokens_expires_at").on(table.expiresAt),
	]
);

export const usersRelations = relations(users, ({ many }) => ({
	refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
	user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenRow = typeof refreshTokens.$inferInsert;
