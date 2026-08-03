/**
 * Testes da camada de persistência.
 *
 * Cobrem mapeamento e resolução de ambiente — o que é lógica pura. O SQL de
 * verdade é exercitado nas suítes `e2e` dos microserviços, contra Postgres real:
 * duplicá-lo aqui exigiria banco para rodar o que deveria ser instantâneo.
 */

/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	rootDir: ".",
	displayName: "database",
	testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
	moduleNameMapper: {
		"^@saude-bliss/contracts$": "<rootDir>/../contracts/src/index.ts",
	},
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},
	clearMocks: true,
	restoreMocks: true,
	testTimeout: 30_000,
	// `migrate.ts` e `seed.ts` são scripts de linha de comando que abrem conexão
	// ao serem carregados; `client.ts` é o pool, exercitado nas suítes e2e.
	collectCoverageFrom: ["src/**/*.ts", "!src/index.ts", "!src/migrate.ts", "!src/seed.ts", "!src/client.ts", "!src/schema/**"],
	coverageThreshold: { global: { branches: 95, functions: 95, lines: 95, statements: 95 } },
};
