/**
 * Testes do microserviço `bliss-authorizer`.
 *
 * Só a camada `unit`: o serviço não expõe rota HTTP nem toca banco, então não há
 * o que exercitar com `app.inject()` ou com Postgres. O contrato dele é a forma
 * do documento de política, que é verificável sem I/O.
 */

/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	rootDir: ".",
	displayName: "unit",
	testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
	moduleNameMapper: {
		"^@saude-bliss/contracts$": "<rootDir>/../../../../packages/contracts/src/index.ts",
		"^@saude-bliss/core$": "<rootDir>/../../../../packages/core/src/index.ts",
		"^@saude-bliss/testing$": "<rootDir>/../../../../packages/testing/src/index.ts",
	},
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},
	clearMocks: true,
	restoreMocks: true,
	setupFiles: ["<rootDir>/__tests__/.jest/setup.ts"],
	/**
	 * 30s, e não os 5s padrão.
	 *
	 * O `beforeAll` das suítes de integração constrói a aplicação inteira, o que
	 * faz o ts-jest compilar `@saude-bliss/core` e o Fastify na primeira vez. Em
	 * máquina de desenvolvimento isso leva ~2s e cabe no padrão; no runner
	 * compartilhado do CI passa de 5s e o hook estoura — com uma mensagem de
	 * timeout que não indica compilação como causa, e que só aparece no CI.
	 */
	testTimeout: 30_000,

	collectCoverageFrom: ["src/**/*.ts"],
	coverageThreshold: {
		global: { branches: 95, functions: 95, lines: 95, statements: 95 },
	},
};
