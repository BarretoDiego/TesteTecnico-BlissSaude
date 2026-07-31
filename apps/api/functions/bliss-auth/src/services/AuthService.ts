/**
 * @module bliss-auth/services/AuthService
 *
 * Regras de autenticação.
 *
 * Emite o par access + refresh, rotaciona e revoga. O access token é assinado
 * com a **mesma chave** que o `bliss-authorizer` usa para validar — é o acoplamento
 * deliberado entre os dois serviços, e a razão de `SigningKeyService` viver no core.
 */

import type { AuthSession, AuthenticatedUser, LoginPayload } from "@saude-bliss/contracts";
import {
	BaseService,
	BlissError,
	envService,
	passwordService,
	signingKeyService,
	type PasswordService,
	type SigningKeyService,
} from "@saude-bliss/core";
import { SignJWT } from "jose";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthRepository } from "../repositories/AuthRepository";

const MODULE = "AuthService";

/**
 * Hash de senha descartável, usado quando o e-mail não existe.
 *
 * Sem ele, um e-mail inexistente responde em ~1ms e um existente em ~100ms — a
 * diferença é medível e transforma o login num oráculo de enumeração de contas.
 * Derivar contra um hash fixo iguala o custo dos dois caminhos.
 */
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class AuthService extends BaseService {
	constructor(
		private readonly repository: AuthRepository = new AuthRepository(),
		private readonly passwords: PasswordService = passwordService,
		private readonly keys: SigningKeyService = signingKeyService
	) {
		super();
	}

	private get accessTokenTtlSeconds(): number {
		return Number(envService.optional("JWT_TTL_SECONDS", "900"));
	}

	private get refreshTokenTtlSeconds(): number {
		return Number(envService.optional("REFRESH_TTL_SECONDS", String(60 * 60 * 24 * 7)));
	}

	/** SHA-256 do refresh token. Ver o comentário na coluna `token_hash`. */
	private hashRefreshToken(token: string): string {
		return createHash("sha256").update(token).digest("hex");
	}

	/**
	 * Emite o par de tokens.
	 *
	 * O refresh token é aleatório de 256 bits — opaco, não um JWT. JWT só deixa
	 * de valer quando expira, e sessão precisa ser revogável no logout.
	 */
	private async issueSession(user: AuthenticatedUser): Promise<AuthSession> {
		const key = await this.keys.getKey();
		const expiresIn = this.accessTokenTtlSeconds;

		const accessToken = await new SignJWT({ email: user.email, roles: user.roles })
			.setProtectedHeader({ alg: "HS256" })
			.setSubject(user.id)
			.setIssuer(envService.optional("JWT_ISSUER", "saude-bliss"))
			.setAudience(envService.optional("JWT_AUDIENCE", "saude-bliss-api"))
			.setIssuedAt()
			.setExpirationTime(`${expiresIn}s`)
			.sign(key);

		const refreshToken = randomBytes(32).toString("base64url");

		await this.repository.storeRefreshToken({
			userId: user.id,
			tokenHash: this.hashRefreshToken(refreshToken),
			expiresAt: new Date(Date.now() + this.refreshTokenTtlSeconds * 1000),
		});

		return { accessToken, expiresIn, tokenType: "Bearer", refreshToken, user };
	}

	/**
	 * Autentica por e-mail e senha.
	 *
	 * A ordem das checagens importa. Credencial errada e conta inexistente
	 * produzem **a mesma** resposta 401, e a conta desativada só é reportada
	 * depois da senha conferir — do contrário o status da conta viraria oráculo:
	 * quem ataca descobriria e-mails cadastrados sem saber senha nenhuma.
	 */
	async login(payload: LoginPayload): Promise<AuthSession> {
		this.logStart(MODULE, "login", "autenticando", { email: payload.email });

		const stored = await this.repository.findCredentialsByEmail(payload.email);

		// Deriva mesmo sem usuário, para igualar o tempo de resposta.
		const matches = await this.passwords.verify(payload.password, stored?.passwordHash ?? DUMMY_HASH);

		if (!stored || !matches) {
			this.logFailed(MODULE, "login", "credenciais inválidas", { email: payload.email });
			throw BlissError.from("INVALID_CREDENTIALS");
		}

		if (!stored.active) {
			this.logFailed(MODULE, "login", "usuário desativado", { userId: stored.user.id });
			throw BlissError.from("USER_INACTIVE", { details: { userId: stored.user.id } });
		}

		const session = await this.issueSession(stored.user);
		await this.repository.touchLastLogin(stored.user.id);

		this.logSuccess(MODULE, "login", "autenticado", { userId: stored.user.id, roles: stored.user.roles });
		return session;
	}

	/**
	 * Troca um refresh token por um par novo, rotacionando.
	 *
	 * Se o token apresentado existe mas já foi revogado, **todas** as sessões do
	 * usuário caem. É a detecção de reuso da OAuth 2.0 Security BCP: um token
	 * revogado voltando significa que ele vazou ou que há duas cópias em uso, e
	 * nos dois casos derrubar a família inteira é a resposta segura.
	 */
	async refresh(refreshToken: string): Promise<AuthSession> {
		const tokenHash = this.hashRefreshToken(refreshToken);
		const active = await this.repository.findActiveRefreshToken(tokenHash);

		if (!active) {
			const reused = await this.repository.refreshTokenExists(tokenHash);
			if (reused) {
				this.logWarning(MODULE, "refresh", "reuso de refresh token detectado", { userId: reused.userId });
				await this.repository.revokeAllForUser(reused.userId);
			} else {
				this.logFailed(MODULE, "refresh", "refresh token desconhecido");
			}
			throw BlissError.from("INVALID_REFRESH_TOKEN");
		}

		const user = await this.repository.findById(active.userId);
		if (!user) {
			// Usuário removido com sessão viva: a FK em cascata torna isso
			// improvável, mas a sessão não pode sobreviver ao dono.
			this.logFailed(MODULE, "refresh", "usuário da sessão não existe mais", { userId: active.userId });
			throw BlissError.from("INVALID_REFRESH_TOKEN");
		}

		const key = await this.keys.getKey();
		const expiresIn = this.accessTokenTtlSeconds;

		const accessToken = await new SignJWT({ email: user.email, roles: user.roles })
			.setProtectedHeader({ alg: "HS256" })
			.setSubject(user.id)
			.setIssuer(envService.optional("JWT_ISSUER", "saude-bliss"))
			.setAudience(envService.optional("JWT_AUDIENCE", "saude-bliss-api"))
			.setIssuedAt()
			.setExpirationTime(`${expiresIn}s`)
			.sign(key);

		const nextRefreshToken = randomBytes(32).toString("base64url");

		await this.repository.rotateRefreshToken(active.id, {
			userId: user.id,
			tokenHash: this.hashRefreshToken(nextRefreshToken),
			expiresAt: new Date(Date.now() + this.refreshTokenTtlSeconds * 1000),
		});

		this.logSuccess(MODULE, "refresh", "sessão renovada", { userId: user.id });
		return { accessToken, expiresIn, tokenType: "Bearer", refreshToken: nextRefreshToken, user };
	}

	/**
	 * Encerra uma sessão.
	 *
	 * Idempotente por decisão: revogar um token já revogado não é erro. Devolver
	 * 404 aqui vazaria quais tokens existem, e não haveria o que o cliente
	 * fizesse de diferente com essa informação.
	 */
	async logout(refreshToken: string): Promise<void> {
		const revoked = await this.repository.revokeRefreshToken(this.hashRefreshToken(refreshToken));
		this.logInfo(MODULE, "logout", revoked ? "sessão encerrada" : "sessão já estava encerrada");
	}

	/**
	 * Identidade de quem está chamando.
	 *
	 * O `userId` vem do contexto que o authorizer anexou — o token já foi validado
	 * na borda, então revalidá-lo aqui só duplicaria trabalho. O que este método
	 * faz é buscar o estado **atual** do usuário, que pode ter mudado desde a
	 * emissão do token.
	 */
	async me(userId: string): Promise<AuthenticatedUser> {
		const user = await this.repository.findById(userId);
		if (!user) {
			this.logFailed(MODULE, "me", "usuário do token não existe mais", { userId });
			throw BlissError.from("INVALID_CREDENTIALS");
		}
		return user;
	}

	/** Conectividade com o banco, para o `/health`. */
	async checkDatabase(): Promise<boolean> {
		return this.repository.ping();
	}
}

/** Comparação em tempo constante de dois tokens opacos. Exposto para os testes. */
export function constantTimeEquals(a: string, b: string): boolean {
	const bufferA = Buffer.from(a);
	const bufferB = Buffer.from(b);
	if (bufferA.length !== bufferB.length) return false;
	return timingSafeEqual(bufferA, bufferB);
}
