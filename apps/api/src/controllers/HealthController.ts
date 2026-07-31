/**
 * @module api/controllers/HealthController
 */

import { BaseController } from "@/common/BaseController";
import { EnvService } from "@/config/EnvService";
import { RequestsService } from "@/services/RequestsService";
import { sbFail, sbSuccess } from "@/utils/responseEnvelope";
import type { FastifyReply, FastifyRequest } from "fastify";

const MODULE = "HealthController";
const startedAt = Date.now();

class HealthController extends BaseController {
	constructor(private readonly requests: RequestsService = new RequestsService()) {
		super();
	}

	/**
	 * `GET /health`.
	 *
	 * Verifica o banco de fato em vez de só responder 200: um healthcheck que não
	 * toca a dependência crítica reporta "saudável" enquanto toda requisição real
	 * falha, que é o pior comportamento possível para um healthcheck.
	 */
	health = async (req: FastifyRequest, res: FastifyReply): Promise<FastifyReply> => {
		const base = {
			env: EnvService.getEnv(),
			uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
			version: process.env.npm_package_version ?? "1.0.0",
		};

		try {
			await this.requests.checkDatabase();
			return sbSuccess(res, req, { data: { status: "ok", database: "up", ...base } });
		} catch (error) {
			this.logError(MODULE, "health", "banco inacessível no healthcheck", { error });
			return sbFail(res, req, 503, {
				code: "DATABASE_UNAVAILABLE",
				message: "Banco de dados indisponível no momento",
				details: { status: "degraded", database: "down", ...base },
			});
		}
	};
}

export default new HealthController();
export { HealthController };
