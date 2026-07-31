/**
 * @module api/services/RequestDatabaseService
 *
 * Camada de acesso a dados das solicitações.
 *
 * Papel de repositório no padrão da casa (`*DatabaseService`). É o **único**
 * módulo que importa `db` ou operadores do Drizzle: quando uma query vaza para o
 * service, testar regra de negócio passa a exigir banco de verdade.
 */

import { BaseRepository } from "@/common/BaseRepository";
import { getDb, type Database } from "@/db/client";
import {
	requestEvents,
	requests,
	type NewRequestEventRow,
	type RequestEventRow,
	type RequestRow,
} from "@/db/schema/requests.schema";
import { getRequestId } from "@/utils/requestContext";
import type {
	ListRequestsQueryPayload,
	Request as RequestDto,
	RequestEvent as RequestEventDto,
	RequestStatus,
} from "@saude-bliss/contracts";
import { and, count, desc, eq, type SQL } from "drizzle-orm";

const MODULE = "RequestDatabaseService";

/**
 * Converte linha do banco para o DTO da API.
 *
 * `Date` vira ISO string aqui, no limite da persistência, para que nenhuma
 * camada acima precise saber que o driver devolve objetos `Date`.
 */
function toRequestDto(row: RequestRow): RequestDto {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		priority: row.priority,
		status: row.status,
		createdBy: row.createdBy,
		reviewedBy: row.reviewedBy,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdTraceId: row.createdTraceId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toEventDto(row: RequestEventRow): RequestEventDto {
	return {
		id: row.id,
		requestId: row.requestId,
		type: row.type,
		fromStatus: row.fromStatus,
		toStatus: row.toStatus,
		actor: row.actor,
		traceId: row.traceId,
		createdAt: row.createdAt.toISOString(),
	};
}

export interface InsertRequestInput {
	title: string;
	description: string;
	priority: RequestDto["priority"];
	createdBy: string;
}

export interface UpdateStatusInput {
	id: string;
	fromStatus: RequestStatus;
	toStatus: Extract<RequestStatus, "reviewed" | "rejected">;
	reviewedBy: string;
}

export interface ListResult {
	items: RequestDto[];
	total: number;
}

export class RequestDatabaseService extends BaseRepository {
	/**
	 * Instância injetável do Drizzle.
	 *
	 * Resolvida sob demanda em vez de no construtor porque `getDb()` é assíncrono
	 * e o construtor não pode aguardar. Testes injetam um duplo e nunca tocam
	 * `getDb`.
	 */
	constructor(private readonly dbPromise: Promise<Database> | null = null) {
		super();
	}

	private async db(): Promise<Database> {
		return this.dbPromise ?? getDb();
	}

	/**
	 * Cria a solicitação e o evento `created` na mesma transação.
	 *
	 * Transação e não duas escritas soltas: sem ela, uma falha entre os dois
	 * inserts deixaria uma solicitação sem trilha de auditoria — exatamente o que
	 * a tela de conferência depende de encontrar.
	 */
	async insert(input: InsertRequestInput): Promise<RequestDto> {
		this.logStart(MODULE, "insert", "inserindo solicitação", { createdBy: input.createdBy });
		const db = await this.db();
		const traceId = getRequestId() ?? null;

		const created = await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(requests)
				.values({ ...input, status: "open", createdTraceId: traceId })
				.returning();

			// Impossível na prática: `.returning()` sempre devolve a linha inserida.
			// A checagem existe porque `noUncheckedIndexedAccess` torna o tipo `| undefined`.
			if (!row) throw new Error("insert de solicitação não retornou linha");

			await tx.insert(requestEvents).values({
				requestId: row.id,
				type: "created",
				fromStatus: null,
				toStatus: "open",
				actor: input.createdBy,
				traceId,
			} satisfies NewRequestEventRow);

			return row;
		});

		this.logSuccess(MODULE, "insert", "solicitação inserida", { id: created.id });
		return toRequestDto(created);
	}

	/** Solicitação por id, ou `null`. Traduzir para 404 é papel do service. */
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
		return rows.map(toEventDto);
	}

	/**
	 * Listagem paginada com filtros opcionais.
	 *
	 * Os filtros são montados como array e combinados com `and(...)`: adicionar um
	 * filtro novo é uma linha, e nenhum encadeamento condicional de `.where()`
	 * precisa ser reescrito.
	 */
	async list(query: ListRequestsQueryPayload): Promise<ListResult> {
		const db = await this.db();

		const conditions: SQL[] = [];
		if (query.createdBy) conditions.push(eq(requests.createdBy, query.createdBy));
		if (query.status) conditions.push(eq(requests.status, query.status));
		if (query.priority) conditions.push(eq(requests.priority, query.priority));
		const where = conditions.length > 0 ? and(...conditions) : undefined;

		const offset = (query.page - 1) * query.pageSize;

		// Contagem e página em paralelo: são independentes, e serializá-las
		// dobraria a latência da tela de listagem sem motivo.
		const [rows, totalResult] = await Promise.all([
			db.select().from(requests).where(where).orderBy(desc(requests.createdAt)).limit(query.pageSize).offset(offset),
			db.select({ value: count() }).from(requests).where(where),
		]);

		return {
			items: rows.map(toRequestDto),
			total: totalResult[0]?.value ?? 0,
		};
	}

	/**
	 * Marca como conferida e registra o evento, atomicamente.
	 *
	 * O `where` inclui `fromStatus`, o que torna a atualização uma operação de
	 * compare-and-set: duas conferências simultâneas da mesma solicitação — cenário
	 * real quando duas pessoas abrem a fila ao mesmo tempo — resultam em uma
	 * vencedora e uma que recebe `null` e vira 409, em vez de as duas sobrescreverem.
	 */
	async updateStatus(input: UpdateStatusInput): Promise<RequestDto | null> {
		this.logStart(MODULE, "updateStatus", "atualizando status", { id: input.id, toStatus: input.toStatus });
		const db = await this.db();
		const traceId = getRequestId() ?? null;
		const now = new Date();

		const updated = await db.transaction(async (tx) => {
			const [row] = await tx
				.update(requests)
				.set({
					status: input.toStatus,
					reviewedBy: input.reviewedBy,
					reviewedAt: now,
					updatedAt: now,
				})
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

		this.logSuccess(MODULE, "updateStatus", "status atualizado", { id: updated.id, status: updated.status });
		return toRequestDto(updated);
	}

	/** Verificação de conectividade para o `/health`. */
	async ping(): Promise<boolean> {
		const db = await this.db();
		await db.select({ value: count() }).from(requests).limit(1);
		return true;
	}
}
