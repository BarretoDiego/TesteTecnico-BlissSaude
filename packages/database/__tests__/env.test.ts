/**
 * Resolução da credencial para os scripts de linha de comando.
 *
 * Este módulo já falhou de verdade: resolvia os caminhos a partir do `cwd`, e
 * `pnpm --filter @saude-bliss/database db:migrate` roda com `cwd` dentro do
 * pacote, onde não existe `.env`. Numa máquina limpa a migration falhava com
 * "nenhuma origem de credencial", mas funcionava para quem já tinha exportado
 * `DATABASE_URL` — o pior tipo de defeito, invisível para quem o escreveu.
 *
 * O `dotenv` e o `existsSync` são substituídos por duplos. Sem isso a suíte leria
 * o disco real e passaria pelo motivo errado: numa máquina com `.env` na raiz o
 * carregamento é exercitado, numa máquina limpa — ou num runner de CI recém
 * clonado — nenhum arquivo existe e o trecho nunca roda. Resultado dependente do
 * ambiente é cobertura que oscila e asserção que não afirma nada.
 */

import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDatabaseEnv } from "../src/env";

jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("node:fs", () => ({
	...jest.requireActual<typeof import("node:fs")>("node:fs"),
	existsSync: jest.fn(),
}));

const configMock = config as jest.MockedFunction<typeof config>;
const existsSyncMock = existsSync as jest.MockedFunction<typeof existsSync>;
const ORIGINAL = { ...process.env };
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/** Caminhos por os quais o módulo procura, na ordem de precedência declarada. */
const CANDIDATOS = [
	join(REPO_ROOT, ".env.local"),
	join(REPO_ROOT, ".env"),
	join(REPO_ROOT, "apps", "api", ".env.local"),
	join(REPO_ROOT, "apps", "api", ".env"),
];

/** Caminhos passados ao `dotenv` nesta execução. */
function caminhosCarregados(): string[] {
	return configMock.mock.calls.map(([opcoes]) => (opcoes as { path: string }).path);
}

function limparAmbiente() {
	for (const chave of [
		"DATABASE_URL",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
		"POSTGRES_DB",
		"POSTGRES_HOST",
		"POSTGRES_PORT",
	]) {
		delete process.env[chave];
	}
}

beforeEach(() => {
	limparAmbiente();
	// Padrão: máquina limpa. Cada teste que precisa de arquivo diz qual existe.
	existsSyncMock.mockReturnValue(false);
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("loadDatabaseEnv — origem dos arquivos", () => {
	it("procura o `.env` a partir da raiz do repositório, não do cwd", () => {
		existsSyncMock.mockReturnValue(true);
		process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";

		loadDatabaseEnv();

		// A asserção que cobre o defeito real: os caminhos precisam ser absolutos e
		// apontar para a raiz. Com `cwd`, `pnpm --filter` executa dentro do pacote
		// e nenhum arquivo é encontrado.
		const caminhos = caminhosCarregados();
		expect(caminhos.length).toBeGreaterThan(0);
		for (const caminho of caminhos) {
			expect(caminho.startsWith(REPO_ROOT)).toBe(true);
		}
	});

	it("procura nos quatro candidatos, na ordem de precedência", () => {
		existsSyncMock.mockReturnValue(true);
		process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";

		loadDatabaseEnv();

		// A ordem é o contrato: o `dotenv` não sobrescreve variável já definida,
		// então quem é lido primeiro vence. Inverter a lista faria o `.env` da raiz
		// perder para o do `apps/api`, silenciosamente.
		expect(caminhosCarregados()).toEqual(CANDIDATOS);
	});

	it("carrega só os arquivos que existem", () => {
		existsSyncMock.mockImplementation((caminho) => caminho === CANDIDATOS[1]);
		process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";

		loadDatabaseEnv();

		// Passar ao `dotenv` um caminho inexistente não quebra, mas mascara: a suíte
		// deixaria de distinguir "achou e leu" de "nem procurou".
		expect(caminhosCarregados()).toEqual([CANDIDATOS[1]]);
	});

	it("não explode quando nenhum arquivo existe", () => {
		// Máquina limpa, sem `.env` ainda copiado: precisa chegar à mensagem de
		// erro útil, e não a um erro de leitura de arquivo.
		process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";

		expect(() => loadDatabaseEnv()).not.toThrow();
		expect(configMock).not.toHaveBeenCalled();
	});
});

describe("loadDatabaseEnv — DATABASE_URL explícita", () => {
	it("tem precedência sobre a composição", () => {
		process.env.DATABASE_URL = "postgresql://explicita@host:5432/db";
		process.env.POSTGRES_USER = "outro";
		process.env.POSTGRES_PASSWORD = "outra";
		process.env.POSTGRES_DB = "outrodb";

		// É o escape hatch que aponta para outro banco sem editar arquivo.
		expect(loadDatabaseEnv()).toBe("postgresql://explicita@host:5432/db");
	});

	it("devolve e também exporta o valor", () => {
		process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";

		const url = loadDatabaseEnv();

		// Quem chama usa o retorno; o Drizzle Kit lê da variável. Os dois precisam
		// concordar.
		expect(process.env.DATABASE_URL).toBe(url);
	});
});

describe("loadDatabaseEnv — composição a partir de POSTGRES_*", () => {
	it("monta a URL com os valores do compose", () => {
		process.env.POSTGRES_USER = "saudebliss";
		process.env.POSTGRES_PASSWORD = "saudebliss";
		process.env.POSTGRES_DB = "saudebliss";

		// O fallback existe para não haver duas fontes de verdade: o `.env` da raiz
		// já declara as credenciais do compose.
		expect(loadDatabaseEnv()).toBe("postgresql://saudebliss:saudebliss@localhost:5433/saudebliss");
	});

	it("usa 5433 como porta padrão", () => {
		process.env.POSTGRES_USER = "u";
		process.env.POSTGRES_PASSWORD = "p";
		process.env.POSTGRES_DB = "d";

		// 5433 e não 5432: o compose publica nessa porta para não colidir com um
		// Postgres já instalado na máquina.
		expect(loadDatabaseEnv()).toContain(":5433/");
	});

	it("respeita host e porta informados", () => {
		process.env.POSTGRES_USER = "u";
		process.env.POSTGRES_PASSWORD = "p";
		process.env.POSTGRES_DB = "d";
		process.env.POSTGRES_HOST = "postgres";
		process.env.POSTGRES_PORT = "5432";

		// `postgres:5432` é como a Lambda alcança o banco de dentro da rede docker.
		expect(loadDatabaseEnv()).toBe("postgresql://u:p@postgres:5432/d");
	});

	it("escapa caractere especial na senha", () => {
		process.env.POSTGRES_USER = "u";
		process.env.POSTGRES_PASSWORD = "p@ss:w/rd?";
		process.env.POSTGRES_DB = "d";

		// Sem escapar, o `@` da senha encerra a parte de credencial e o driver tenta
		// conectar num host inventado — com erro que não menciona a senha.
		const url = loadDatabaseEnv();

		expect(url).toContain(encodeURIComponent("p@ss:w/rd?"));
		expect(() => new URL(url)).not.toThrow();
	});

	it("produz uma URL que o parser aceita", () => {
		process.env.POSTGRES_USER = "saudebliss";
		process.env.POSTGRES_PASSWORD = "saudebliss";
		process.env.POSTGRES_DB = "saudebliss";

		const url = new URL(loadDatabaseEnv());

		expect(url.protocol).toBe("postgresql:");
		expect(url.username).toBe("saudebliss");
		expect(url.pathname).toBe("/saudebliss");
	});

	it.each([
		["sem usuário", { POSTGRES_PASSWORD: "p", POSTGRES_DB: "d" }],
		["sem senha", { POSTGRES_USER: "u", POSTGRES_DB: "d" }],
		["sem base", { POSTGRES_USER: "u", POSTGRES_PASSWORD: "p" }],
	])("não compõe %s", (_caso, vars) => {
		Object.assign(process.env, vars);

		// Compor com campo faltando produziria uma URL sintaticamente válida que
		// falha só na conexão — erro longe da causa.
		expect(() => loadDatabaseEnv()).toThrow(/DATABASE_URL/);
	});
});

describe("loadDatabaseEnv — nenhuma origem", () => {
	it("falha com mensagem que diz o que configurar", () => {
		let capturado: Error | null = null;
		try {
			loadDatabaseEnv();
		} catch (erro) {
			capturado = erro as Error;
		}

		// A mensagem precisa nomear as duas saídas possíveis: quem lê está numa
		// máquina limpa e não sabe qual das duas o projeto espera.
		expect(capturado).not.toBeNull();
		expect(capturado!.message).toMatch(/DATABASE_URL/);
		expect(capturado!.message).toMatch(/POSTGRES_USER/);
	});
});
