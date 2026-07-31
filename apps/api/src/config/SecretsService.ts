/**
 * @module api/config/SecretsService
 *
 * Resolução da connection string do banco.
 *
 * Local lê `DATABASE_URL` do `.env`; em AWS/LocalStack busca no Secrets Manager,
 * que é onde o Terraform escreve as credenciais do RDS. A Lambda nunca recebe
 * senha em variável de ambiente — variável de ambiente aparece no console e em
 * qualquer `GetFunctionConfiguration`.
 */

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { EnvService } from "./EnvService";

/** Formato escrito pelo Terraform em `aws_secretsmanager_secret_version`. */
interface DatabaseSecret {
	username: string;
	password: string;
	host: string;
	port: number;
	dbname: string;
}

/**
 * Cache em escopo de módulo: sobrevive entre invocações no mesmo container, o
 * que elimina uma chamada ao Secrets Manager por request. Sem isso, cada request
 * paga ~50ms e a conta de API calls cresce sem motivo.
 */
let cachedConnectionString: string | undefined;
let client: SecretsManagerClient | undefined;

function getClient(): SecretsManagerClient {
	if (!client) {
		const endpoint = EnvService.getAwsEndpoint();
		client = new SecretsManagerClient({
			region: EnvService.getRegion(),
			...(endpoint ? { endpoint } : {}),
		});
	}
	return client;
}

export class SecretsService {
	/**
	 * Connection string do Postgres.
	 *
	 * Precedência: `DATABASE_URL` explícita vence sempre. Isso permite apontar a
	 * Lambda para o Postgres do compose com uma variável, que é o escape hatch
	 * quando o RDS emulado do LocalStack dá problema.
	 */
	static async getDatabaseUrl(): Promise<string> {
		if (cachedConnectionString) return cachedConnectionString;

		const explicit = process.env.DATABASE_URL;
		if (explicit) {
			cachedConnectionString = explicit;
			return explicit;
		}

		const secretId = process.env.DB_SECRET_ID;
		if (!secretId) {
			throw new Error("Defina DATABASE_URL ou DB_SECRET_ID para conectar ao banco");
		}

		const response = await getClient().send(new GetSecretValueCommand({ SecretId: secretId }));
		if (!response.SecretString) {
			throw new Error(`Secret ${secretId} não possui SecretString`);
		}

		const secret = JSON.parse(response.SecretString) as DatabaseSecret;
		const password = encodeURIComponent(secret.password);
		cachedConnectionString = `postgresql://${secret.username}:${password}@${secret.host}:${secret.port}/${secret.dbname}`;
		return cachedConnectionString;
	}

	/** Limpa o cache. Existe para os testes — nunca chamado em runtime. */
	static resetCache(): void {
		cachedConnectionString = undefined;
		client = undefined;
	}
}
