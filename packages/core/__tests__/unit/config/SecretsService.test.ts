/**
 * Resolução da credencial do banco.
 *
 * O cache em escopo de módulo é o comportamento crítico: sem ele cada requisição
 * na Lambda pagaria uma chamada ao Secrets Manager (~50ms) e a conta de API calls
 * cresceria sem motivo.
 */

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { SecretsService } from "../../../src/config/SecretsService";

const secretsMock = mockClient(SecretsManagerClient);
const ORIGINAL = { ...process.env };

beforeEach(() => {
	secretsMock.reset();
	SecretsService.resetCache();
	delete process.env.DATABASE_URL;
	delete process.env.DB_SECRET_ID;
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("SecretsService.getDatabaseUrl — DATABASE_URL explícita", () => {
	it("tem precedência sobre o Secrets Manager", async () => {
		process.env.DATABASE_URL = "postgresql://u:p@host:5432/db";
		process.env.DB_SECRET_ID = "/local/saude-bliss/database/credentials";

		await expect(SecretsService.getDatabaseUrl()).resolves.toBe("postgresql://u:p@host:5432/db");

		// É o escape hatch que aponta a Lambda para o Postgres do compose quando o
		// RDS emulado dá problema — precisa vencer sempre.
		expect(secretsMock.calls()).toHaveLength(0);
	});
});

describe("SecretsService.getDatabaseUrl — Secrets Manager", () => {
	const secret = { username: "saudebliss", password: "senha", host: "db.local", port: 5432, dbname: "saudebliss" };

	it("monta a connection string a partir do segredo", async () => {
		process.env.DB_SECRET_ID = "/local/saude-bliss/database/credentials";
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(secret) });

		await expect(SecretsService.getDatabaseUrl()).resolves.toBe(
			"postgresql://saudebliss:senha@db.local:5432/saudebliss"
		);
	});

	it("escapa caracteres especiais da senha", async () => {
		process.env.DB_SECRET_ID = "/local/saude-bliss/database/credentials";
		secretsMock.on(GetSecretValueCommand).resolves({
			SecretString: JSON.stringify({ ...secret, password: "p@ss:w/ord" }),
		});

		// Sem o encode, um `@` ou `/` na senha quebra o parsing da URL e o driver
		// tenta conectar em um host inventado.
		await expect(SecretsService.getDatabaseUrl()).resolves.toContain("p%40ss%3Aw%2Ford");
	});

	it("busca o segredo uma única vez e reaproveita entre chamadas", async () => {
		process.env.DB_SECRET_ID = "/local/saude-bliss/database/credentials";
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(secret) });

		await SecretsService.getDatabaseUrl();
		await SecretsService.getDatabaseUrl();
		await SecretsService.getDatabaseUrl();

		// Cache em escopo de módulo sobrevive entre invocações no mesmo container.
		expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
	});

	it("aponta para o endpoint customizado quando AWS_ENDPOINT_URL está definida", async () => {
		// É o que faz o SDK falar com o LocalStack em vez do Secrets Manager real.
		process.env.AWS_ENDPOINT_URL = "http://localhost:4568";
		process.env.DB_SECRET_ID = "/local/saude-bliss/database/credentials";
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(secret) });

		await expect(SecretsService.getDatabaseUrl()).resolves.toContain("db.local");
		expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
	});

	it("lança quando o segredo não tem SecretString", async () => {
		process.env.DB_SECRET_ID = "/local/saude-bliss/database/credentials";
		secretsMock.on(GetSecretValueCommand).resolves({});

		await expect(SecretsService.getDatabaseUrl()).rejects.toThrow(/SecretString/);
	});
});

describe("SecretsService.getDatabaseUrl — configuração ausente", () => {
	it("lança quando nem DATABASE_URL nem DB_SECRET_ID estão definidas", async () => {
		await expect(SecretsService.getDatabaseUrl()).rejects.toThrow(/DATABASE_URL.*DB_SECRET_ID/);
	});
});
