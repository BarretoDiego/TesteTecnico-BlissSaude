/**
 * Testes do runtime compartilhado.
 *
 * Ficam junto do código que testam: `core` é publicado para todos os
 * microserviços, então uma regressão aqui quebra todos de uma vez e precisa ser
 * pega no próprio pacote, não na suíte de um serviço qualquer.
 */

/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	rootDir: ".",
	displayName: "core",
	testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
	moduleNameMapper: {
		"^@saude-bliss/contracts$": "<rootDir>/../contracts/src/index.ts",
		"^@saude-bliss/testing$": "<rootDir>/../testing/src/index.ts",
	},
	transform: {
		// ts-jest em `transform` e não em `globals`: a forma via `globals` está
		// depreciada e emite warning a cada execução.
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},
	// Sem isso, um mock configurado num teste vaza para o seguinte e produz
	// falhas que só aparecem quando a ordem de execução muda.
	clearMocks: true,
	restoreMocks: true,
	setupFiles: ["<rootDir>/__tests__/.jest/setup.ts"],
	collectCoverageFrom: ["src/**/*.ts", "!src/index.ts", "!src/app/**"],
	coverageThreshold: { global: { branches: 95, functions: 95, lines: 95, statements: 95 } },
};
