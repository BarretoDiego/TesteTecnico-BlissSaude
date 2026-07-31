/**
 * @module bliss-reviews/repositories/ReviewsRepository
 *
 * Acesso a dados do domínio de conferência.
 *
 * Contém apenas as operações deste domínio: ler o estado atual, aplicar a
 * conferência e registrar o evento. As escritas de abertura ficam no
 * `bliss-requests`. O banco é compartilhado, mas a fronteira de responsabilidade
 * continua visível — cada serviço só sabe escrever o que é seu.
 */

import type { Request as RequestDto, RequestEvent as RequestEventDto, RequestStatus } from "@saude-bliss/contracts";
import { BaseRepository, getRequestId } from "@saude-bliss/core";
import {
	getDb,
	requestEvents,
	requests,
	toRequestDto,
	toRequestEventDto,
	type Database,
	type NewRequestEventRow,
} from "@saude-bliss/database";
import { and, count, desc, eq } from "drizzle-orm";

const MODULE = "ReviewsRepository";

export interface UpdateStatusInput {
	id: string;
	fromStatus: RequestStatus;
	toStatus: Extract<RequestStatus, "reviewed" | "rejected">;
	reviewedBy: string;
	note?: string;
}

export class ReviewsRepository extends BaseRepository {
	constructor(private readonly dbPromise: Promise<Database> | null = null) {
		super();
	}

	private async db(): Promise<Database> {
		return this.dbPromise ?? getDb();
	}

	/** Estado atual da solicitação, ou `null`. Traduzir para 404 é papel do service. */
	async findById(id: string): Promise<RequestDto | null> {
		const db = await this.db();
		const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
		return row ? toRequestDto(row) : null;
	}

	/** Linha do tempo da solicitação, mais recente primeiro. */
	async findEventsByRequestId(id: string): Promise<RequestEventDto[]> {
		const db = await this.db();
		const rows = await db
			.select()
			.from(requestEvents)
			.where(eq(requestEvents.requestId, id))
			.orderBy(desc(requestEvents.createdAt));
		return rows.map(toRequestEventDto);
	}

	/**
	 * Aplica a conferência e registra o evento, atomicamente.
	 *
	 * O `where` inclui `fromStatus`, o que torna a atualização um compare-and-set:
	 * duas conferências simultâneas da mesma solicitação — cenário real quando
	 * duas pessoas abrem a fila ao mesmo tempo — resultam em uma vencedora e uma
	 * que recebe `null` e vira 409, em vez de as duas sobrescreverem.
	 */
	async updateStatus(input: UpdateStatusInput): Promise<RequestDto | null> {
		this.logStart(MODULE, "updateStatus", "aplicando conferência", { id: input.id, toStatus: input.toStatus });
		const db = await this.db();
		const traceId = getRequestId() ?? null;
		const now = new Date();

		const updated = await db.transaction(async (tx) => {
			const [row] = await tx
				.update(requests)
				.set({ status: input.toStatus, reviewedBy: input.reviewedBy, reviewedAt: now, updatedAt: now })
				.where(and(eq(requests.id, input.id), eq(requests.status, input.fromStatus)))
				.returning();

			if (!row) return null;

			await tx.insert(requestEvents).values({
				requestId: row.id,
				type: "reviewed",
				fromStatus: input.fromStatus,
				toStatus: input.toStatus,
				actor: input.reviewedBy,
				traceId,
			} satisfies NewRequestEventRow);

			return row;
		});

		if (!updated) {
			this.logFailed(MODULE, "updateStatus", "status mudou entre a leitura e a escrita", { id: input.id });
			return null;
		}

		this.logSuccess(MODULE, "updateStatus", "conferência aplicada", { id: updated.id, status: updated.status });
		return toRequestDto(updated);
	}

	/** Verificação de conectividade para o `/health`. */
	async ping(): Promise<boolean> {
		const db = await this.db();
		await db.select({ value: count() }).from(requests).limit(1);
		return true;
	}
}
