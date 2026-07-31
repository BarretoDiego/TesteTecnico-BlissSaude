/**
 * @module bliss-auth/controllers/AuthController
 *
 * Orquestração HTTP da autenticação.
 */

import { BaseController, BlissError, DefaultErroHandler, blissSuccess } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
	TLoginFastifyRequest,
	TLogoutFastifyRequest,
	TRefreshFastifyRequest,
} from "../middlewares/AuthMiddlewares";
import { AuthService } from "../services/AuthService";

const MODULE = "AuthController";

/**
 * Identidade que o authorizer anexou ao evento.
 *
 * O API Gateway a entrega em `event.requestContext.authorizer`, e o
 * `@fastify/aws-lambda` a repassa em `req.awsLambda.event`. Ler daqui — e não do
 * header `Authorization` — é o que evita revalidar o token que a borda já validou.
 */
function principalIdFrom(req: FastifyRequest): string {
	const event = (req as { awsLambda?: { event?: { requestContext?: { authorizer?: Record<string, string> } } } })
		.awsLambda?.event;
	const authorizer = event?.requestContext?.authorizer;
	const userId = authorizer?.userId ?? authorizer?.principalId;

	if (!userId) {
		// Sem contexto do authorizer não há como saber quem chama. Acontece quando
		// a rota é exposta sem autorização por engano — falhar alto aqui é melhor
		// do que devolver o usuário errado.
		throw BlissError.from("INVALID_CREDENTIALS", {
			message: "Requisição sem identidade autenticada",
		});
	}
	return userId;
}

class AuthController extends BaseController {
	constructor(private readonly auth: AuthService = new AuthService()) {
		super();
	}

	/** `POST /auth/login` → 200. */
	login = async (req: FastifyRequest<TLoginFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "login", "autenticando", { email: req.body.email });
			const session = await this.auth.login(req.body);
			this.logSuccess(MODULE, "login", "autenticado", { userId: session.user.id });
			return blissSuccess(res, req, { data: session, message: "Autenticado com sucesso" });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "login" });
		}
	};

	/** `POST /auth/refresh` → 200. */
	refresh = async (req: FastifyRequest<TRefreshFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "refresh", "renovando sessão");
			const session = await this.auth.refresh(req.body.refreshToken);
			this.logSuccess(MODULE, "refresh", "sessão renovada", { userId: session.user.id });
			return blissSuccess(res, req, { data: session });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "refresh" });
		}
	};

	/** `POST /auth/logout` → 200. */
	logout = async (req: FastifyRequest<TLogoutFastifyRequest>, res: FastifyReply): Promise<FastifyReply> => {
		try {
			this.logStart(MODULE, "logout", "encerrando sessão");
			await this.auth.logout(req.body.refreshToken);
			this.logSuccess(MODULE, "logout", "sessão encerrada");
			return blissSuccess(res, req, { data: { revoked: true as const }, message: "Sessão encerrada" });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "logout" });
		}
	};

	/** `GET /auth/me` → 200. */
	me = async (req: FastifyRequest, res: FastifyReply): Promise<FastifyReply> => {
		try {
			const userId = principalIdFrom(req);
			this.logStart(MODULE, "me", "consultando identidade", { userId });
			const user = await this.auth.me(userId);
			this.logSuccess(MODULE, "me", "identidade resolvida", { userId });
			return blissSuccess(res, req, { data: user });
		} catch (error) {
			return DefaultErroHandler(error, res, req, { module: MODULE, action: "me" });
		}
	};
}

export default new AuthController();
export { AuthController, principalIdFrom };
