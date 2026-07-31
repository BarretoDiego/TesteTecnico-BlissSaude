/**
 * @module bliss-requests/services/RequestsService
 *
 * Regras de domínio das solicitações.
 *
 * Não conhece HTTP nem SQL: recebe dados já validados pelo middleware, aplica
 * regra e delega persistência ao repositório. É o que permite testar as regras
 * do domínio sem subir Fastify nem Postgres.
 */

import {
	type CreateRequestPayload,
	type ListRequestsQueryPayload,
	type ListRequestsResult,
	type RequestDetail,
	type Request as RequestDto,
} from "@saude-bliss/contracts";
import { BaseService, BlissError } from "@saude-bliss/core";
import { RequestsRepository } from "../repositories/RequestsRepository";

const MODULE = "RequestsService";

export class RequestsService extends BaseService {
	constructor(private readonly repository: RequestsRepository = new RequestsRepository()) {
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
			throw BlissError.from("REQUEST_NOT_FOUND", { details: { id } });
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

	/** Conectividade com o banco, para o `/health`. */
	async checkDatabase(): Promise<boolean> {
		return this.repository.ping();
	}
}
