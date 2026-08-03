/**
 * @module core/config/EnvService
 *
 * Resolução de ambiente e variáveis.
 *
 * Um único ponto que normaliza aliases de ambiente
 * (`development`, `staging`, `prd`…) e responde `isLocalEnv()` / `isAWSEnv()`.
 * Sem isso, comparações de string espalhadas pelo código divergem — alguém
 * escreve `=== "dev"` e o valor chegou como `"development"`, e a condição passa
 * a ser sempre falsa em silêncio.
 *
 * É um `BaseService` como qualquer outra camada, então observa com o mesmo
 * logging estruturado do resto. O log aqui é deliberadamente escasso: leitura de
 * variável acontece em caminho quente e uma linha por leitura afogaria o log
 * útil. Registra-se o que surpreende — alias desconhecido, obrigatória ausente —
 * e nada mais.
 */

import { BaseService } from "../common/BaseService";

export type AppEnv = "local" | "dev" | "stage" | "prod";

const MODULE = "EnvService";

const ENV_ALIASES: Readonly<Record<string, AppEnv>> = {
	local: "local",
	localhost: "local",
	test: "local",
	dev: "dev",
	development: "dev",
	stage: "stage",
	staging: "stage",
	stg: "stage",
	beta: "stage",
	prod: "prod",
	production: "prod",
	prd: "prod",
};

export class EnvService extends BaseService {
	/** Ambiente normalizado. `local` é o default seguro: nunca assume produção. */
	getEnv(): AppEnv {
		const raw = (process.env.BLISS_ENV ?? process.env.NODE_ENV ?? "local").toLowerCase().trim();
		const resolved = ENV_ALIASES[raw];

		if (!resolved) {
			// Valor digitado errado nunca deve fazer o serviço se comportar como
			// produção — mas também não pode passar despercebido.
			this.logWarning(MODULE, "getEnv", "ambiente desconhecido, assumindo local", { raw });
			return "local";
		}
		return resolved;
	}

	isLocalEnv(): boolean {
		return this.getEnv() === "local";
	}

	/** `true` quando roda em Lambda de verdade ou no LocalStack. */
	isAWSEnv(): boolean {
		return !this.isLocalEnv() || this.isLambdaRuntime();
	}

	/**
	 * `true` quando o processo é uma invocação de Lambda.
	 *
	 * Distinto de `isLocalEnv()`: `local` é o nome do **ambiente**, e uma Lambda
	 * implantada no LocalStack roda com `BLISS_ENV=local`. Confundir os dois faz
	 * um recurso pensado para a máquina de desenvolvimento ser habilitado dentro
	 * da função — foi assim que o Swagger UI, que lê assets do disco, quebrou
	 * toda requisição com ENOENT depois do primeiro deploy.
	 */
	isLambdaRuntime(): boolean {
		return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
	}

	getRegion(): string {
		return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
	}

	/**
	 * Endpoint customizado da AWS. Preenchido só no LocalStack — em produção fica
	 * `undefined` e os SDKs usam o endpoint real.
	 */
	getAwsEndpoint(): string | undefined {
		return process.env.AWS_ENDPOINT_URL || undefined;
	}

	getLogLevel(): string {
		return process.env.LOG_LEVEL ?? (this.isLocalEnv() ? "debug" : "info");
	}

	getPort(): number {
		return Number(process.env.PORT ?? 4001);
	}

	getApiPrefix(): string {
		return process.env.API_PREFIX ?? "/v1";
	}

	/**
	 * Lê uma variável obrigatória.
	 *
	 * Falha alto e cedo em vez de deixar `undefined` virar uma connection string
	 * `"undefined"` e um erro de driver incompreensível três camadas abaixo.
	 */
	required(name: string): string {
		const value = process.env[name];
		if (!value) {
			this.logError(MODULE, "required", "variável de ambiente obrigatória ausente", { name });
			throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
		}
		return value;
	}

	optional(name: string, fallback: string): string {
		return process.env[name] || fallback;
	}

	flag(name: string, fallback = false): boolean {
		const value = process.env[name];
		if (value === undefined) return fallback;
		return ["1", "true", "yes", "on"].includes(value.toLowerCase());
	}
}

/**
 * Instância compartilhada.
 *
 * Resolução de ambiente não tem estado e é lida em toda parte, então um singleton
 * evita instanciar a classe em cada chamador. A classe segue exportada para o
 * teste poder injetar um logger próprio.
 */
export const envService = new EnvService();
