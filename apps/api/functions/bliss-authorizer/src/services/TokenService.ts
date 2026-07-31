/**
 * @module bliss-authorizer/services/TokenService
 *
 * Validação do token de acesso.
 *
 * Usa `jose` em vez de verificação artesanal: comparar assinatura HMAC à mão é
 * curto de escrever e fácil de escrever errado — comparação não constante,
 * `alg: none` aceito, `exp` não conferido. Nenhum desses erros aparece em teste
 * de caminho feliz.
 *
 * O segredo vem do Secrets Manager em AWS e de `JWT_SECRET` em local, pela mesma
 * regra do banco: credencial não vai em variável de ambiente da função, porque
 * variável de ambiente aparece no console e em qualquer `GetFunctionConfiguration`.
 */

import { BaseService, envService, secretsManagerService, type SecretsManagerService } from "@saude-bliss/core";
import { jwtVerify, type JWTPayload } from "jose";

const MODULE = "TokenService";

/** Claims que o sistema espera no token, além das padrão do JWT. */
export interface AccessTokenClaims extends JWTPayload {
	sub: string;
	email?: string;
	/** Papéis do usuário, ex.: `["reviewer"]`. */
	roles?: string[];
}

export class TokenService extends BaseService {
	private cachedKey: Uint8Array | undefined;

	constructor(private readonly secrets: SecretsManagerService = secretsManagerService) {
		super();
	}

	/**
	 * Chave de assinatura, cacheada em escopo de instância.
	 *
	 * O authorizer é invocado a cada token novo (o API Gateway cacheia o
	 * resultado, não a chave), então buscar o segredo por invocação custaria uma
	 * chamada de rede no caminho de autenticação de toda sessão nova.
	 */
	private async getKey(): Promise<Uint8Array> {
		if (this.cachedKey) return this.cachedKey;

		const explicit = process.env.JWT_SECRET;
		if (explicit) {
			this.cachedKey = new TextEncoder().encode(explicit);
			return this.cachedKey;
		}

		const secretId = process.env.JWT_SECRET_ID;
		if (!secretId) {
			this.logError(MODULE, "getKey", "nenhuma origem de chave configurada");
			throw new Error("Defina JWT_SECRET ou JWT_SECRET_ID para validar tokens");
		}

		const secret = await this.secrets.getSecretJson<{ signingKey: string }>(secretId);
		this.cachedKey = new TextEncoder().encode(secret.signingKey);
		return this.cachedKey;
	}

	/**
	 * Extrai o token do header `Authorization`.
	 *
	 * O API Gateway normaliza headers de forma inconsistente entre integrações,
	 * então as duas grafias são aceitas. O esquema `Bearer` é conferido: aceitar
	 * o valor cru deixaria passar `Authorization: <token>` sem esquema, que é
	 * como uma credencial vaza em log de proxy mal configurado.
	 */
	extractToken(headers: Record<string, string | undefined> = {}): string {
		const raw = headers.authorization ?? headers.Authorization;
		if (!raw) throw new Error("header Authorization ausente");

		const [scheme, token] = raw.split(" ");
		if (scheme?.toLowerCase() !== "bearer" || !token) {
			throw new Error("header Authorization deve usar o esquema Bearer");
		}
		return token;
	}

	/**
	 * Valida o token e devolve as claims.
	 *
	 * O algoritmo é fixado em HS256. Sem essa restrição, um token forjado com
	 * `alg: none` — ou com um algoritmo que a chave simétrica também satisfaz —
	 * seria aceito: é a vulnerabilidade de confusão de algoritmo, e a defesa é
	 * declarar o esperado em vez de confiar no cabeçalho do token.
	 */
	async verify(token: string): Promise<AccessTokenClaims> {
		const key = await this.getKey();

		const { payload } = await jwtVerify(token, key, {
			algorithms: ["HS256"],
			issuer: envService.optional("JWT_ISSUER", "saude-bliss"),
			audience: envService.optional("JWT_AUDIENCE", "saude-bliss-api"),
			// `jose` já rejeita token expirado; a tolerância cobre desvio de relógio
			// entre quem assina e quem valida, que em ambiente distribuído é real.
			clockTolerance: 5,
		});

		if (!payload.sub) throw new Error("token sem claim `sub`");

		return payload as AccessTokenClaims;
	}

	/** Limpa a chave em cache. Existe para os testes e para rotação forçada. */
	resetCache(): void {
		this.cachedKey = undefined;
		this.secrets.clearCache();
	}
}
