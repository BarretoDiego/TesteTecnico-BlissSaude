/**
 * @module bliss-reviews/services/ReviewsService
 *
 * Regras de domínio da conferência.
 *
 * Não conhece HTTP nem SQL: recebe dados já validados pelo middleware, aplica a
 * regra de transição e delega persistência ao repositório.
 */

import type {
	RequestDetail,
	Request as RequestDto,
	RequestEvent as RequestEventDto,
	ReviewRequestPayload,
} from "@saude-bliss/contracts";
import { canTransition } from "@saude-bliss/contracts";
import { BaseService, BlissError } from "@saude-bliss/core";
import { ReviewsRepository } from "../repositories/ReviewsRepository";

const MODULE = "ReviewsService";

export class ReviewsService extends BaseService {
	constructor(private readonly repository: ReviewsRepository = new ReviewsRepository()) {
		super();
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
			throw BlissError.from("REQUEST_NOT_FOUND", { details: { id } });
		}

		if (current.status === "reviewed" || current.status === "rejected") {
			this.logFailed(MODULE, "review", "solicitação já conferida", { id, status: current.status });
			throw BlissError.from("REQUEST_ALREADY_REVIEWED", {
				details: { id, status: current.status, reviewedBy: current.reviewedBy },
			});
		}

		if (!canTransition(current.status, payload.status)) {
			this.logFailed(MODULE, "review", "transição de status inválida", {
				id,
				from: current.status,
				to: payload.status,
			});
			throw BlissError.from("INVALID_STATUS_TRANSITION", {
				details: { id, from: current.status, to: payload.status },
			});
		}

		const updated = await this.repository.updateStatus({
			id,
			fromStatus: current.status,
			toStatus: payload.status,
			reviewedBy: payload.reviewedBy,
			note: payload.note,
		});

		// `null` significa que outra requisição conferiu entre a leitura e a escrita.
		if (!updated) {
			this.logFailed(MODULE, "review", "conferência concorrente detectada", { id });
			throw BlissError.from("REQUEST_ALREADY_REVIEWED", { details: { id } });
		}

		this.logSuccess(MODULE, "review", "solicitação conferida", { id, status: updated.status });
		return updated;
	}

	/**
	 * Linha do tempo da solicitação.
	 *
	 * Exposta por este serviço, e não pelo de solicitações, porque a trilha de
	 * auditoria é o artefato da conferência — é o que a operação consulta para
	 * provar quem conferiu o quê e quando.
	 */
	async getTimeline(id: string): Promise<RequestDetail> {
		const request = await this.repository.findById(id);
		if (!request) {
			this.logFailed(MODULE, "getTimeline", "solicitação não encontrada", { id });
			throw BlissError.from("REQUEST_NOT_FOUND", { details: { id } });
		}

		const events: RequestEventDto[] = await this.repository.findEventsByRequestId(id);
		return { ...request, events };
	}

	/** Conectividade com o banco, para o `/health`. */
	async checkDatabase(): Promise<boolean> {
		return this.repository.ping();
	}
}
