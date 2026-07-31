/**
 * @module core/security/SigningKeyService
 *
 * Chave de assinatura dos tokens de acesso.
 *
 * Compartilhada entre **quem assina** (`bliss-auth`) e **quem valida**
 * (`bliss-authorizer`). É por isso que vive no core: se cada serviço resolvesse
 * a chave do seu jeito, bastaria um deles ler de outra origem para todo token
 * emitido ser rejeitado — e a falha apareceria como 401 genérico, sem indicar a
 * causa.
 */

import { secretsManagerService, type SecretsManagerService } from "../aws/SecretsManagerService";
import { BaseService } from "../common/BaseService";

const MODULE = "SigningKeyService";

export class SigningKeyService extends BaseService {
	private cached: Uint8Array | undefined;

	constructor(private readonly secrets: SecretsManagerService = secretsManagerService) {
		super();
	}

	/**
	 * Chave em bytes, cacheada em escopo de instância.
	 *
	 * `JWT_SECRET` tem precedência para o ambiente local; em AWS vem do Secrets
	 * Manager, pela mesma regra da credencial do banco — segredo não vai em
	 * variável de ambiente da função, porque variável de ambiente aparece no
	 * console e em qualquer `GetFunctionConfiguration`.
	 */
	async getKey(): Promise<Uint8Array> {
		if (this.cached) return this.cached;

		const explicit = process.env.JWT_SECRET;
		if (explicit) {
			this.cached = new TextEncoder().encode(explicit);
			return this.cached;
		}

		const secretId = process.env.JWT_SECRET_ID;
		if (!secretId) {
			this.logError(MODULE, "getKey", "nenhuma origem de chave configurada");
			throw new Error("Defina JWT_SECRET ou JWT_SECRET_ID para assinar e validar tokens");
		}

		const secret = await this.secrets.getSecretJson<{ signingKey: string }>(secretId);
		this.cached = new TextEncoder().encode(secret.signingKey);
		return this.cached;
	}

	/** Limpa o cache. Existe para os testes e para rotação forçada. */
	resetCache(): void {
		this.cached = undefined;
		this.secrets.clearCache();
	}
}

export const signingKeyService = new SigningKeyService();
