/**
 * Testes dos contratos compartilhados.
 *
 * Este pacote é a fronteira entre API, backoffice e automação: um schema que
 * aceita o que não devia, ou recusa o que devia passar, quebra os três de uma
 * vez. Sem I/O e sem dependência — a suíte inteira roda em menos de um segundo.
 */

/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	rootDir: ".",
	displayName: "contracts",
	testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},
	clearMocks: true,
	restoreMocks: true,
	testTimeout: 30_000,
	collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
	coverageThreshold: { global: { branches: 95, functions: 95, lines: 95, statements: 95 } },
};
