/**
 * Resolução de ambiente.
 *
 * A normalização de alias é o ponto: sem ela, comparações de string espalhadas
 * pelo código divergem — alguém escreve `=== "dev"` e o valor chegou como
 * `"development"`, e a condição passa a ser sempre falsa em silêncio.
 */

import { EnvService } from "../../../src/config/EnvService";

const ORIGINAL = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL };
});

function setEnv(values: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

describe("EnvService.getEnv", () => {
	it.each([
		["local", "local"],
		["localhost", "local"],
		["test", "local"],
		["dev", "dev"],
		["development", "dev"],
		["stage", "stage"],
		["staging", "stage"],
		["stg", "stage"],
		["beta", "stage"],
		["prod", "prod"],
		["production", "prod"],
		["prd", "prod"],
	])("normaliza %p para %p", (raw, expected) => {
		setEnv({ BLISS_ENV: raw, NODE_ENV: undefined });

		expect(EnvService.getEnv()).toBe(expected);
	});

	it("ignora caixa e espaços", () => {
		setEnv({ BLISS_ENV: "  PRODUCTION  " });

		expect(EnvService.getEnv()).toBe("prod");
	});

	it("cai para local quando o valor é desconhecido", () => {
		setEnv({ BLISS_ENV: "homologacao" });

		// `local` é o default seguro: um valor digitado errado nunca deve fazer o
		// serviço se comportar como produção.
		expect(EnvService.getEnv()).toBe("local");
	});

	it("usa NODE_ENV quando BLISS_ENV não está definido", () => {
		setEnv({ BLISS_ENV: undefined, NODE_ENV: "production" });

		expect(EnvService.getEnv()).toBe("prod");
	});

	it("cai para local quando nenhuma variável está definida", () => {
		setEnv({ BLISS_ENV: undefined, NODE_ENV: undefined });

		expect(EnvService.getEnv()).toBe("local");
	});
});

describe("EnvService.isLocalEnv / isAWSEnv", () => {
	it("identifica ambiente local", () => {
		setEnv({ BLISS_ENV: "local", AWS_LAMBDA_FUNCTION_NAME: undefined });

		expect(EnvService.isLocalEnv()).toBe(true);
		expect(EnvService.isAWSEnv()).toBe(false);
	});

	it.each(["dev", "stage", "prod"])("identifica %s como ambiente AWS", (env) => {
		setEnv({ BLISS_ENV: env, AWS_LAMBDA_FUNCTION_NAME: undefined });

		expect(EnvService.isLocalEnv()).toBe(false);
		expect(EnvService.isAWSEnv()).toBe(true);
	});

	it("reconhece AWS mesmo com BLISS_ENV=local quando roda em Lambda", () => {
		// Cenário real: LocalStack, onde o ambiente lógico é local mas o código
		// executa dentro de um container de Lambda de verdade.
		setEnv({ BLISS_ENV: "local", AWS_LAMBDA_FUNCTION_NAME: "bliss-requests-lambda-local" });

		expect(EnvService.isAWSEnv()).toBe(true);
	});
});

describe("EnvService — leitura de variáveis", () => {
	it("usa a região configurada, com fallback para us-east-1", () => {
		setEnv({ AWS_REGION: "sa-east-1" });
		expect(EnvService.getRegion()).toBe("sa-east-1");

		setEnv({ AWS_REGION: undefined, AWS_DEFAULT_REGION: undefined });
		expect(EnvService.getRegion()).toBe("us-east-1");
	});

	it("retorna undefined para o endpoint da AWS quando vazio", () => {
		// `undefined` e não string vazia: o SDK só usa o endpoint padrão se o
		// campo estiver ausente.
		setEnv({ AWS_ENDPOINT_URL: "" });

		expect(EnvService.getAwsEndpoint()).toBeUndefined();
	});

	it("retorna o endpoint customizado quando definido", () => {
		setEnv({ AWS_ENDPOINT_URL: "http://localhost:4568" });

		expect(EnvService.getAwsEndpoint()).toBe("http://localhost:4568");
	});

	it("usa debug como nível de log em local e info fora dele", () => {
		setEnv({ LOG_LEVEL: undefined, BLISS_ENV: "local" });
		expect(EnvService.getLogLevel()).toBe("debug");

		setEnv({ BLISS_ENV: "prod" });
		expect(EnvService.getLogLevel()).toBe("info");
	});

	it("respeita LOG_LEVEL explícito", () => {
		setEnv({ LOG_LEVEL: "warn", BLISS_ENV: "local" });

		expect(EnvService.getLogLevel()).toBe("warn");
	});

	it("lê porta e prefixo com defaults", () => {
		setEnv({ PORT: undefined, API_PREFIX: undefined });
		expect(EnvService.getPort()).toBe(4001);
		expect(EnvService.getApiPrefix()).toBe("/v1");

		setEnv({ PORT: "8080", API_PREFIX: "/api" });
		expect(EnvService.getPort()).toBe(8080);
		expect(EnvService.getApiPrefix()).toBe("/api");
	});
});

describe("EnvService.required", () => {
	it("devolve o valor quando presente", () => {
		setEnv({ MINHA_VAR: "valor" });

		expect(EnvService.required("MINHA_VAR")).toBe("valor");
	});

	it.each([undefined, ""])("lança quando a variável está %p", (value) => {
		setEnv({ MINHA_VAR: value });

		// Falhar alto e cedo: sem isso `undefined` vira a string "undefined" numa
		// connection string e o erro aparece três camadas abaixo, indecifrável.
		expect(() => EnvService.required("MINHA_VAR")).toThrow(/MINHA_VAR/);
	});
});

describe("EnvService.optional e flag", () => {
	it("usa o fallback quando a variável está ausente ou vazia", () => {
		setEnv({ MINHA_VAR: undefined });
		expect(EnvService.optional("MINHA_VAR", "padrão")).toBe("padrão");

		setEnv({ MINHA_VAR: "" });
		expect(EnvService.optional("MINHA_VAR", "padrão")).toBe("padrão");
	});

	it.each(["1", "true", "TRUE", "yes", "on"])("interpreta %p como verdadeiro", (value) => {
		setEnv({ MINHA_FLAG: value });

		expect(EnvService.flag("MINHA_FLAG")).toBe(true);
	});

	it.each(["0", "false", "no", "off", "qualquer"])("interpreta %p como falso", (value) => {
		setEnv({ MINHA_FLAG: value });

		expect(EnvService.flag("MINHA_FLAG")).toBe(false);
	});

	it("usa o fallback quando a flag não está definida", () => {
		setEnv({ MINHA_FLAG: undefined });

		expect(EnvService.flag("MINHA_FLAG")).toBe(false);
		expect(EnvService.flag("MINHA_FLAG", true)).toBe(true);
	});
});
