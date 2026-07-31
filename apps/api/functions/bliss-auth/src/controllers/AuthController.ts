/**
 * @module bliss-auth/controllers/AuthController
 *
 * Orquestração HTTP da autenticação.
 */

import { BaseController, DefaultErroHandler, blissSuccess } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
	TLoginFastifyRequest,
	TLogoutFastifyRequest,
	TRefreshFastifyRequest,
} from "../middlewares/AuthMiddlewares";
import { AuthService } from "../services/AuthService";

const MODULE = "AuthController";

/**
 * Identidade que o authorizer anexou ao evento, quando há uma.
 *
 * O API Gateway a entrega em `event.requestContext.authorizer`, e o
 * `@fastify/aws-lambda` a repassa em `req.awsLambda.event`. Ler daqui — e não do
 * header `Authorization` — evita revalidar o token que a borda já validou.
 */
function principalIdFromAuthorizer(req: FastifyRequest): string | undefined {
	const event = (req as { awsLambda?: { event?: { requestContext?: { authorizer?: Record<string, string> } } } })
		.awsLambda?.event;
	const authorizer = event?.requestContext?.authorizer;
	return authorizer?.userId ?? authorizer?.principalId;
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

	/**
	 * `GET /auth/me` → 200.
	 *
	 * Resolve a identidade em duas etapas. Em produção o authorizer já validou o
	 * token e anexou o contexto ao evento — é o caminho preferido, e evita
	 * revalidar o que a borda validou.
	 *
	 * Sem esse contexto, valida o `Authorization` diretamente. Isso não é um
	 * atalho de conveniência: sem ele o endpoint é **inutilizável fora da Lambda**,
	 * porque nem `run.all.local` nem o LocalStack Community executam authorizer —
	 * e um endpoint que só funciona implantado não é exercitável pelo backoffice
	 * nem pela automação.
	 */
	me = async (req: FastifyRequest, res: FastifyReply): Promise<FastifyReply> => {
		try {
			const userId = principalIdFromAuthorizer(req) ?? (await this.auth.resolvePrincipal(req.headers.authorization));
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
export { AuthController, principalIdFromAuthorizer };
