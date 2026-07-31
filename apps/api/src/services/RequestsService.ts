/**
 * @module api/services/RequestsService
 *
 * Regras de domínio das solicitações.
 *
 * Não conhece HTTP nem SQL: recebe dados já validados pelo middleware, aplica
 * regra e delega persistência ao repositório. É o que permite testar as regras
 * de transição sem subir Fastify nem Postgres.
 */

import { BaseService } from "@/common/BaseService";
import { SBError } from "@/errors/SBError";
import {
	canTransition,
	type CreateRequestPayload,
	type ListRequestsQueryPayload,
	type ListRequestsResult,
	type RequestDetail,
	type Request as RequestDto,
	type ReviewRequestPayload,
} from "@saude-bliss/contracts";
import { RequestDatabaseService } from "./RequestDatabaseService";

const MODULE = "RequestsService";

export class RequestsService extends BaseService {
	constructor(private readonly repository: RequestDatabaseService = new RequestDatabaseService()) {
		super();
	}

	/**
	 * Cria uma solicitação.
	 *
	 * `status` não é parâmetro de propósito: nasce sempre `open`. O schema de
	 * entrada é `.strict()`, então tentar enviá-lo resulta em 400 em vez de ser
	 * ignorado em silêncio.
	 */
	async create(payload: CreateRequestPayload): Promise<RequestDto> {
		this.logStart(MODULE, "create", "criando solicitação", { createdBy: payload.createdBy });
		const created = await this.repository.insert({
			title: payload.title,
			description: payload.description,
			priority: payload.priority,
			createdBy: payload.createdBy,
		});
		this.logSuccess(MODULE, "create", "solicitação criada", { id: created.id });
		return created;
	}

	/** Solicitação por id. Lança `REQUEST_NOT_FOUND` (404) quando não existe. */
	async getById(id: string): Promise<RequestDetail> {
		const request = await this.repository.findById(id);
		if (!request) {
			this.logFailed(MODULE, "getById", "solicitação não encontrada", { id });
			throw SBError.from("REQUEST_NOT_FOUND", { details: { id } });
		}

		const events = await this.repository.findEventsByRequestId(id);
		return { ...request, events };
	}

	/** Listagem paginada com filtros. */
	async list(query: ListRequestsQueryPayload): Promise<ListRequestsResult> {
		const { items, total } = await this.repository.list(query);
		return {
			items,
			pagination: {
				page: query.page,
				pageSize: query.pageSize,
				total,
				// `Math.max(…, 1)` para que uma listagem vazia devolva 1 página e não 0 —
				// paginador de front costuma quebrar com totalPages 0.
				totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
			},
		};
	}

	/**
	 * Registra a conferência de uma solicitação.
	 *
	 * Valida a transição antes de escrever, para devolver 409 com um erro
	 * específico em vez de uma atualização silenciosamente sem efeito. O
	 * compare-and-set no repositório cobre a corrida entre esta checagem e a
	 * escrita — as duas defesas são necessárias: uma dá boa mensagem, a outra dá
	 * correção.
	 */
	async review(id: string, payload: ReviewRequestPayload): Promise<RequestDto> {
		this.logStart(MODULE, "review", "conferindo solicitação", { id, reviewedBy: payload.reviewedBy });

		const current = await this.repository.findById(id);
		if (!current) {
			this.logFailed(MODULE, "review", "solicitação não encontrada", { id });
			throw SBError.from("REQUEST_NOT_FOUND", { details: { id } });
		}

		if (current.status === "reviewed" || current.status === "rejected") {
			this.logFailed(MODULE, "review", "solicitação já conferida", { id, status: current.status });
			throw SBError.from("REQUEST_ALREADY_REVIEWED", {
				details: { id, status: current.status, reviewedBy: current.reviewedBy },
			});
		}

		if (!canTransition(current.status, payload.status)) {
			this.logFailed(MODULE, "review", "transição de status inválida", {
				id,
				from: current.status,
				to: payload.status,
			});
			throw SBError.from("INVALID_STATUS_TRANSITION", {
				details: { id, from: current.status, to: payload.status },
			});
		}

		const updated = await this.repository.updateStatus({
			id,
			fromStatus: current.status,
			toStatus: payload.status,
			reviewedBy: payload.reviewedBy,
		});

		// `null` significa que outra requisição conferiu entre a leitura e a escrita.
		if (!updated) {
			this.logFailed(MODULE, "review", "conferência concorrente detectada", { id });
			throw SBError.from("REQUEST_ALREADY_REVIEWED", { details: { id } });
		}

		this.logSuccess(MODULE, "review", "solicitação conferida", { id, status: updated.status });
		return updated;
	}

	/** Conectividade com o banco, para o `/health`. */
	async checkDatabase(): Promise<boolean> {
		return this.repository.ping();
	}
}
