/**
 * @module bliss-reviews/controllers/ReviewsController
 *
 * Orquestração HTTP da conferência.
 *
 * Controllers são finos por regra: logam início, chamam o service, logam sucesso
 * e montam o envelope. Nenhuma decisão de negócio acontece aqui — se um `if` de
 * regra aparecer neste arquivo, ele pertence ao service.
 */

import { BaseController, blissSuccess, DefaultErroHandler } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { TGetTimelineFastifyRequest } from "../middlewares/GetTimelineMiddleware";
import type { TReviewRequestFastifyRequest } from "../middlewares/ReviewRequestMiddleware";
import { ReviewsService } from "../services/ReviewsService";

const MODULE = "ReviewsController";

class ReviewsController extends BaseController {
	/**
	 * Dependência com default no construtor: produção usa o default, teste passa
	 * um duplo. Resolve injeção de dependência sem container nem decorator.
	 */
	constructor(private readonly reviews: ReviewsService = new ReviewsService()) {
		super();
	}

	/** `PATCH /requests/{id}/review` → 200, 404 ou 409. */
	review = async (req: FastifyRequest<TReviewRequestFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "review", "conferindo solicitação", {
				id: req.params.id,
				reviewedBy: req.body.reviewedBy,
			});
			const result = await this.reviews.review(req.params.id, req.body);
			this.logSuccess(MODULE, "review", "solicitação conferida", { id: result.id, status: result.status });
			return blissSuccess(res, req, { data: result, message: "Conferência registrada com sucesso" });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "review" });
		}
	};

	/** `GET /requests/{id}/timeline` → 200 ou 404. */
	getTimeline = async (req: FastifyRequest<TGetTimelineFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "getTimeline", "consultando trilha de auditoria", { id: req.params.id });
			const result = await this.reviews.getTimeline(req.params.id);
			this.logSuccess(MODULE, "getTimeline", "trilha consultada", { id: result.id, events: result.events.length });
			return blissSuccess(res, req, { data: result });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "getTimeline" });
		}
	};
}

export default new ReviewsController();
export { ReviewsController };
