/**
 * @module bliss-auth/repositories/AuthRepository
 *
 * Acesso a dados do domínio de autenticação.
 *
 * É o único lugar que enxerga `passwordHash`. Nenhum método o devolve para fora
 * a não ser `findCredentialsByEmail`, cujo nome deixa explícito o que está sendo
 * carregado — e cujo retorno o service consome e descarta.
 */

import type { AuthenticatedUser } from "@saude-bliss/contracts";
import { BaseRepository } from "@saude-bliss/core";
import {
	getDb,
	refreshTokens,
	toAuthenticatedUser,
	users,
	type Database,
	type NewRefreshTokenRow,
} from "@saude-bliss/database";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";

const MODULE = "AuthRepository";

export interface StoredCredentials {
	user: AuthenticatedUser;
	passwordHash: string;
	active: boolean;
}

export interface StoreRefreshTokenInput {
	userId: string;
	tokenHash: string;
	expiresAt: Date;
}

export class AuthRepository extends BaseRepository {
	constructor(private readonly dbPromise: Promise<Database> | null = null) {
		super();
	}

	private async db(): Promise<Database> {
		return this.dbPromise ?? getDb();
	}

	/**
	 * Credenciais por e-mail, ou `null`.
	 *
	 * Devolve `active` em vez de filtrar por ele na query: o service precisa
	 * distinguir "não existe" de "existe mas está desativado" para responder 403
	 * em vez de 401 — mas só **depois** de conferir a senha, para não transformar
	 * o status da conta em oráculo de enumeração.
	 */
	async findCredentialsByEmail(email: string): Promise<StoredCredentials | null> {
		const db = await this.db();
		const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
		if (!row) return null;

		return { user: toAuthenticatedUser(row), passwordHash: row.passwordHash, active: row.active };
	}

	async findById(id: string): Promise<AuthenticatedUser | null> {
		const db = await this.db();
		const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
		return row ? toAuthenticatedUser(row) : null;
	}

	/** Marca o último acesso. Falha aqui não deve derrubar o login. */
	async touchLastLogin(userId: string): Promise<void> {
		const db = await this.db();
		await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
	}

	async storeRefreshToken(input: StoreRefreshTokenInput): Promise<void> {
		const db = await this.db();
		await db.insert(refreshTokens).values(input satisfies NewRefreshTokenRow);
	}

	/**
	 * Sessão ativa correspondente ao hash, ou `null`.
	 *
	 * O `where` exige não revogada **e** não expirada. Filtrar no banco em vez de
	 * na aplicação evita que uma checagem esquecida em algum caminho aceite um
	 * token que já não vale.
	 */
	async findActiveRefreshToken(tokenHash: string): Promise<{ id: string; userId: string } | null> {
		const db = await this.db();
		const [row] = await db
			.select({ id: refreshTokens.id, userId: refreshTokens.userId })
			.from(refreshTokens)
			.where(
				and(
					eq(refreshTokens.tokenHash, tokenHash),
					isNull(refreshTokens.revokedAt),
					gt(refreshTokens.expiresAt, new Date())
				)
			)
			.limit(1);

		return row ?? null;
	}

	/**
	 * Rotaciona o refresh token: revoga o antigo e grava o novo, atomicamente.
	 *
	 * Transação porque as duas escritas precisam acontecer juntas. Se a revogação
	 * ocorresse sem a gravação, a sessão morreria no meio de um refresh; se a
	 * gravação ocorresse sem a revogação, os dois tokens valeriam ao mesmo tempo,
	 * que é exatamente o que a rotação existe para impedir.
	 */
	async rotateRefreshToken(currentId: string, next: StoreRefreshTokenInput): Promise<void> {
		this.logStart(MODULE, "rotateRefreshToken", "rotacionando sessão", { userId: next.userId });
		const db = await this.db();

		await db.transaction(async (tx) => {
			await tx
				.update(refreshTokens)
				.set({ revokedAt: new Date(), replacedByHash: next.tokenHash })
				.where(eq(refreshTokens.id, currentId));

			await tx.insert(refreshTokens).values(next satisfies NewRefreshTokenRow);
		});
	}

	/** Revoga uma sessão específica — o logout. */
	async revokeRefreshToken(tokenHash: string): Promise<boolean> {
		const db = await this.db();
		const rows = await db
			.update(refreshTokens)
			.set({ revokedAt: new Date() })
			.where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
			.returning({ id: refreshTokens.id });

		return rows.length > 0;
	}

	/**
	 * Revoga **todas** as sessões do usuário.
	 *
	 * Chamado quando um refresh token já revogado é reapresentado: ou o token
	 * vazou, ou houve corrida de cliente. Nos dois casos derrubar a família
	 * inteira de sessões é a resposta segura — é a detecção de reuso recomendada
	 * pela OAuth 2.0 Security BCP.
	 */
	async revokeAllForUser(userId: string): Promise<number> {
		this.logWarning(MODULE, "revokeAllForUser", "revogando todas as sessões do usuário", { userId });
		const db = await this.db();
		const rows = await db
			.update(refreshTokens)
			.set({ revokedAt: new Date() })
			.where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
			.returning({ id: refreshTokens.id });

		return rows.length;
	}

	/** Existe uma sessão com este hash, ainda que revogada ou expirada? */
	async refreshTokenExists(tokenHash: string): Promise<{ userId: string } | null> {
		const db = await this.db();
		const [row] = await db
			.select({ userId: refreshTokens.userId })
			.from(refreshTokens)
			.where(eq(refreshTokens.tokenHash, tokenHash))
			.limit(1);

		return row ?? null;
	}

	/** Remove sessões expiradas. Manutenção — não faz parte de nenhum fluxo. */
	async purgeExpired(): Promise<number> {
		const db = await this.db();
		const rows = await db
			.delete(refreshTokens)
			.where(lt(refreshTokens.expiresAt, new Date()))
			.returning({ id: refreshTokens.id });

		return rows.length;
	}

	/** Verificação de conectividade para o `/health`. */
	async ping(): Promise<boolean> {
		const db = await this.db();
		await db
			.select({ value: sql<number>`1` })
			.from(users)
			.limit(1);
		return true;
	}
}
