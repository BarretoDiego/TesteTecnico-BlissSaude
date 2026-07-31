/**
 * @module api/config/EnvService
 *
 * Resolução de ambiente e variáveis.
 *
 * Segue o padrão da casa: um único ponto que normaliza aliases de ambiente
 * (`development`, `staging`, `prd`…) e responde `isLocalEnv()` / `isAWSEnv()`.
 * Sem isso, comparações de string espalhadas pelo código divergem — alguém
 * escreve `=== "dev"` e o valor chegou como `"development"`.
 */

export type AppEnv = "local" | "dev" | "stage" | "prod";

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

export class EnvService {
	/** Ambiente normalizado. `local` é o default seguro: nunca assume produção. */
	static getEnv(): AppEnv {
		const raw = (process.env.SB_ENV ?? process.env.NODE_ENV ?? "local").toLowerCase().trim();
		return ENV_ALIASES[raw] ?? "local";
	}

	static isLocalEnv(): boolean {
		return this.getEnv() === "local";
	}

	/** `true` quando roda em Lambda de verdade ou no LocalStack. */
	static isAWSEnv(): boolean {
		return !this.isLocalEnv() || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
	}

	static getRegion(): string {
		return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
	}

	/**
	 * Endpoint customizado da AWS. Preenchido só no LocalStack — em produção fica
	 * `undefined` e os SDKs usam o endpoint real.
	 */
	static getAwsEndpoint(): string | undefined {
		return process.env.AWS_ENDPOINT_URL || undefined;
	}

	static getLogLevel(): string {
		return process.env.LOG_LEVEL ?? (this.isLocalEnv() ? "debug" : "info");
	}

	static getPort(): number {
		return Number(process.env.PORT ?? 4001);
	}

	static getApiPrefix(): string {
		return process.env.API_PREFIX ?? "/v1";
	}

	/**
	 * Lê uma variável obrigatória.
	 *
	 * Falha alto e cedo em vez de deixar `undefined` virar uma connection string
	 * `"undefined"` e um erro de driver incompreensível três camadas abaixo.
	 */
	static required(name: string): string {
		const value = process.env[name];
		if (!value) {
			throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
		}
		return value;
	}

	static optional(name: string, fallback: string): string {
		return process.env[name] || fallback;
	}

	static flag(name: string, fallback = false): boolean {
		const value = process.env[name];
		if (value === undefined) return fallback;
		return ["1", "true", "yes", "on"].includes(value.toLowerCase());
	}
}
