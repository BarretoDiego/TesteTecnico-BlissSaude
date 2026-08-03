/**
 * Testes do backoffice.
 *
 * Cobrem a camada de serviços e o provedor de sessão — a lógica que decide o que
 * o usuário vê e o que vai para a API. As telas em si são exercitadas pela suíte
 * Playwright contra o sistema real; reimplementá-las aqui com DOM simulado
 * duplicaria o esforço e testaria o simulador.
 *
 * `jsdom` porque o interceptor usa `crypto.randomUUID` e o provedor usa
 * `localStorage` — os dois só existem em ambiente de browser.
 */

/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "jsdom",
	rootDir: ".",
	displayName: "web",
	testMatch: ["<rootDir>/__tests__/**/*.test.ts", "<rootDir>/__tests__/**/*.test.tsx"],
	moduleNameMapper: {
		"^~/(.*)$": "<rootDir>/src/$1",
		"^@saude-bliss/contracts$": "<rootDir>/../../packages/contracts/src/index.ts",
	},
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
	},
	clearMocks: true,
	restoreMocks: true,
	testTimeout: 30_000,
	setupFiles: ["<rootDir>/__tests__/.jest/setup.ts"],
	// `toHaveTextContent` e afins — carregados depois do ambiente estar de pé.
	setupFilesAfterEnv: ["<rootDir>/__tests__/.jest/setup-dom.ts"],
	collectCoverageFrom: ["src/services/**/*.ts", "src/providers/**/*.tsx", "src/lib/**/*.ts"],
	// Statements, linhas e funções em 95%+; branches em 75 porque os ramos
	// restantes são inalcançáveis pelo caminho real: o `??` de mensagem e de
	// `requestId` nos catch (o interceptor sempre produz `ApiError` preenchido) e
	// o ramo de servidor do `resolveBaseUrl`, que não existe sob jsdom. Forçar
	// 95 ali exigiria simular o módulo, testando o simulador e não o código.
	coverageThreshold: { global: { branches: 75, functions: 95, lines: 95, statements: 95 } },
};
