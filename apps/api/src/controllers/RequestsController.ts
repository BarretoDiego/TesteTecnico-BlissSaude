/**
 * @module api/controllers/RequestsController
 *
 * Orquestração HTTP das solicitações.
 *
 * Controllers são finos por regra: logam início, chamam o service, logam sucesso
 * e montam o envelope. Nenhuma decisão de negócio acontece aqui — se um `if` de
 * regra aparecer neste arquivo, ele pertence ao service.
 */

import { BaseController } from "@/common/BaseController";
import { DefaultErroHandler } from "@/errors/DefaultErroHandler";
import type { TCreateRequestFastifyRequest } from "@/middlewares/CreateRequestMiddleware";
import type { TGetRequestFastifyRequest } from "@/middlewares/GetRequestMiddleware";
import type { TListRequestsFastifyRequest } from "@/middlewares/ListRequestsMiddleware";
import type { TReviewRequestFastifyRequest } from "@/middlewares/ReviewRequestMiddleware";
import { RequestsService } from "@/services/RequestsService";
import { sbSuccess } from "@/utils/responseEnvelope";
import type { FastifyReply, FastifyRequest } from "fastify";

const MODULE = "RequestsController";

class RequestsController extends BaseController {
	/**
	 * Dependência com default no construtor: produção usa o default, teste passa
	 * um duplo. Resolve injeção de dependência sem container nem decorator.
	 */
	constructor(private readonly requests: RequestsService = new RequestsService()) {
		super();
	}

	/** `POST /requests` → 201. */
	create = async (req: FastifyRequest<TCreateRequestFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "create", "criando solicitação", { createdBy: req.body.createdBy });
			const result = await this.requests.create(req.body);
			this.logSuccess(MODULE, "create", "solicitação criada", { id: result.id });
			return sbSuccess(res, req, {
				data: result,
				statusCode: 201,
				message: "Solicitação criada com sucesso",
			});
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "create" });
		}
	};

	/** `GET /requests/{id}` → 200 ou 404. */
	getById = async (req: FastifyRequest<TGetRequestFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "getById", "consultando solicitação", { id: req.params.id });
			const result = await this.requests.getById(req.params.id);
			this.logSuccess(MODULE, "getById", "solicitação encontrada", { id: result.id });
			return sbSuccess(res, req, { data: result });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "getById" });
		}
	};

	/** `GET /requests?createdBy=&status=` → 200. */
	list = async (req: FastifyRequest<TListRequestsFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "list", "listando solicitações", {
				createdBy: req.query.createdBy,
				status: req.query.status,
				page: req.query.page,
			});
			const result = await this.requests.list(req.query);
			this.logSuccess(MODULE, "list", "solicitações listadas", {
				total: result.pagination.total,
				returned: result.items.length,
			});
			return sbSuccess(res, req, { data: result });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "list" });
		}
	};

	/** `PATCH /requests/{id}/review` → 200, 404 ou 409. */
	review = async (req: FastifyRequest<TReviewRequestFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "review", "conferindo solicitação", {
				id: req.params.id,
				reviewedBy: req.body.reviewedBy,
			});
			const result = await this.requests.review(req.params.id, req.body);
			this.logSuccess(MODULE, "review", "solicitação conferida", { id: result.id, status: result.status });
			return sbSuccess(res, req, {
				data: result,
				message: "Conferência registrada com sucesso",
			});
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "review" });
		}
	};
}

export default new RequestsController();
export { RequestsController };
