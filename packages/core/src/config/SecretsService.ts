/**
 * @module core/config/SecretsService
 *
 * Resolução da credencial do banco.
 *
 * Local lê `DATABASE_URL` do `.env`; em AWS/LocalStack busca no Secrets Manager,
 * que é onde o Terraform escreve as credenciais do RDS. A Lambda nunca recebe
 * senha em variável de ambiente — variável de ambiente aparece no console e em
 * qualquer `GetFunctionConfiguration`.
 *
 * A conversa com a AWS fica no `SecretsManagerService` (camada de integração);
 * aqui mora apenas a regra de **qual** segredo usar e como montar a connection
 * string a partir dele.
 */

import { secretsManagerService, type SecretsManagerService } from "../aws/SecretsManagerService";
import { BaseService } from "../common/BaseService";

const MODULE = "SecretsService";

/** Formato escrito pelo Terraform em `aws_secretsmanager_secret_version`. */
interface DatabaseSecret {
	username: string;
	password: string;
	host: string;
	port: number;
	dbname: string;
}

export class SecretsService extends BaseService {
	/**
	 * Cache da string montada, separado do cache de segredo bruto do
	 * `SecretsManagerService`: poupa repetir o parse e a montagem da URL, ainda
	 * que a chamada de rede já estivesse evitada.
	 */
	private connectionString: string | undefined;

	constructor(private readonly secrets: SecretsManagerService = secretsManagerService) {
		super();
	}

	/**
	 * Connection string do Postgres.
	 *
	 * Precedência: `DATABASE_URL` explícita vence sempre. É o escape hatch que
	 * aponta a Lambda para o Postgres do compose quando o RDS emulado do
	 * LocalStack dá problema — precisa vencer inclusive sobre um `DB_SECRET_ID`
	 * já configurado.
	 */
	async getDatabaseUrl(): Promise<string> {
		if (this.connectionString) return this.connectionString;

		const explicit = process.env.DATABASE_URL;
		if (explicit) {
			this.logInfo(MODULE, "getDatabaseUrl", "usando DATABASE_URL do ambiente");
			this.connectionString = explicit;
			return explicit;
		}

		const secretId = process.env.DB_SECRET_ID;
		if (!secretId) {
			this.logError(MODULE, "getDatabaseUrl", "nenhuma origem de credencial configurada");
			throw new Error("Defina DATABASE_URL ou DB_SECRET_ID para conectar ao banco");
		}

		const secret = await this.secrets.getSecretJson<DatabaseSecret>(secretId);

		// `encodeURIComponent` na senha: um `@` ou `/` sem escape quebra o parsing
		// da URL e o driver tenta conectar em um host inventado.
		const password = encodeURIComponent(secret.password);
		this.connectionString = `postgresql://${secret.username}:${password}@${secret.host}:${secret.port}/${secret.dbname}`;

		this.logSuccess(MODULE, "getDatabaseUrl", "credencial resolvida via Secrets Manager", {
			secretId,
			host: secret.host,
			dbname: secret.dbname,
		});
		return this.connectionString;
	}

	/** Limpa o cache. Existe para os testes — nunca chamado em runtime. */
	resetCache(): void {
		this.connectionString = undefined;
		this.secrets.clearCache();
	}
}

export const secretsService = new SecretsService();
