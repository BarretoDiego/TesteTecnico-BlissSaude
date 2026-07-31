/**
 * Testes do microserviço `bliss-auth`.
 *
 * Os projects espelham as camadas do padrão da casa e permitem rodar cada uma
 * isoladamente (`--selectProjects unit`). A separação importa na prática:
 * `unit` e `contract` não tocam I/O e rodam em ~1s, então é o que se executa a
 * cada save; `e2e` precisa de Postgres no ar e fica para o pipeline.
 */

/** @type {import("ts-jest").JestConfigWithTsJest} */
const base = {
	preset: "ts-jest",
	testEnvironment: "node",
	rootDir: ".",
	moduleNameMapper: {
		"^@saude-bliss/contracts$": "<rootDir>/../../../../packages/contracts/src/index.ts",
		"^@saude-bliss/core$": "<rootDir>/../../../../packages/core/src/index.ts",
		"^@saude-bliss/database$": "<rootDir>/../../../../packages/database/src/index.ts",
		"^@saude-bliss/testing$": "<rootDir>/../../../../packages/testing/src/index.ts",
	},
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},
	clearMocks: true,
	restoreMocks: true,
	setupFiles: ["<rootDir>/__tests__/.jest/setup.ts"],
};

module.exports = {
	/**
	 * 30s, e não os 5s padrão.
	 *
	 * O `beforeAll` das suítes de integração constrói a aplicação inteira, o que
	 * faz o ts-jest compilar `@saude-bliss/core` e o Fastify na primeira vez. Em
	 * máquina de desenvolvimento isso leva ~2s e cabe no padrão; no runner
	 * compartilhado do CI passa de 5s e o hook estoura — com uma mensagem de
	 * timeout que não indica compilação como causa, e que só aparece no CI.
	 *
	 * Fica na raiz, e não dentro de `base`: `testTimeout` é opção **global** do
	 * Jest, e declarada dentro de um project é descartada em silêncio.
	 */
	testTimeout: 30_000,

	projects: [
		{ ...base, displayName: "unit", testMatch: ["<rootDir>/__tests__/unit/**/*.test.ts"] },
		{ ...base, displayName: "integration", testMatch: ["<rootDir>/__tests__/integration/**/*.test.ts"] },
		{ ...base, displayName: "contract", testMatch: ["<rootDir>/__tests__/contract/**/*.test.ts"] },
		{
			...base,
			displayName: "e2e",
			testMatch: ["<rootDir>/__tests__/e2e/**/*.test.ts"],
			// Postgres real: transações concorrentes de arquivos diferentes na mesma
			// base produzem falha intermitente. Serializar é mais barato que isolar.
			maxWorkers: 1,
			setupFiles: [...base.setupFiles, "<rootDir>/__tests__/.jest/setup-e2e.ts"],
		},
	],

	collectCoverageFrom: [
		"src/**/*.ts",
		// Composição de framework e barrels não têm lógica para cobrir; incluí-los
		// só dilui a métrica.
		"!src/app.ts",
		"!src/router/index.ts",
		"!src/**/index.ts",
	],
	// Limites conferidos contra a execução real, não aspiracionais. Statements,
	// linhas e funções ficam em 95%+; branches fica abaixo porque parte dos
	// ramos são fallbacks defensivos sem caminho de negócio que os atinja
	// (o `where` opcional do Drizzle, o coerce do Zod). Forçar 95% ali
	// produziria teste escrito para a métrica, não para o comportamento.
	coverageThreshold: {
		global: { branches: 75, functions: 95, lines: 95, statements: 95 },
		"./src/middlewares/": { branches: 50, functions: 95, lines: 95, statements: 95 },
		"./src/services/": { branches: 76, functions: 95, lines: 95, statements: 95 },
	},
};
