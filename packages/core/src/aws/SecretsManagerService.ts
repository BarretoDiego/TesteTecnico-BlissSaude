/**
 * @module core/aws/SecretsManagerService
 *
 * Leitura de segredos no AWS Secrets Manager.
 *
 * Cacheia por id em escopo de módulo: sem isso, cada requisição na Lambda pagaria
 * uma chamada de rede (~50ms) e a conta de API calls cresceria proporcional ao
 * tráfego, sem nenhum ganho — segredo muda em rotação, não a cada request.
 */

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { BaseService } from "../common/BaseService";
import { getAwsClient } from "./AwsClientFactory";

const MODULE = "SecretsManagerService";

export class SecretsManagerService extends BaseService {
	private readonly cache = new Map<string, string>();

	private get client(): SecretsManagerClient {
		return getAwsClient("secretsmanager", (config) => new SecretsManagerClient(config));
	}

	/** Conteúdo bruto do segredo. */
	async getSecretString(secretId: string): Promise<string> {
		const cached = this.cache.get(secretId);
		if (cached) return cached;

		this.logStart(MODULE, "getSecretString", "buscando segredo", { secretId });
		const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));

		if (!response.SecretString) {
			this.logError(MODULE, "getSecretString", "segredo sem SecretString", { secretId });
			throw new Error(`Secret ${secretId} não possui SecretString`);
		}

		this.cache.set(secretId, response.SecretString);
		// O valor nunca entra no log — só a confirmação de que foi obtido.
		this.logSuccess(MODULE, "getSecretString", "segredo obtido", { secretId });
		return response.SecretString;
	}

	/** Segredo desserializado como JSON. */
	async getSecretJson<TSecret>(secretId: string): Promise<TSecret> {
		const raw = await this.getSecretString(secretId);
		try {
			return JSON.parse(raw) as TSecret;
		} catch (error) {
			this.logError(MODULE, "getSecretJson", "segredo não é JSON válido", { secretId, error });
			throw new Error(`Secret ${secretId} não contém JSON válido`);
		}
	}

	/** Limpa o cache. Existe para os testes e para rotação forçada. */
	clearCache(): void {
		this.cache.clear();
	}
}

export const secretsManagerService = new SecretsManagerService();
