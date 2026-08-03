/**
 * Configuração do Playwright.
 *
 * Dois projects — headless e headed — para que o modo de execução seja uma
 * escolha de linha de comando, em vez de uma variável de ambiente que alguém
 * esquece de definir.
 */

import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

export default defineConfig({
	testDir: "./tests",
	timeout: 45_000,
	expect: { timeout: 10_000 },

	/**
	 * Serial de propósito.
	 *
	 * A conferência **muta estado compartilhado**: marcar uma solicitação como
	 * revisada a remove da fila que outro teste poderia estar lendo. Cada teste
	 * semeia seus próprios dados com um `createdBy` único, o que já isola os
	 * dados — mas a fila da tela é global, e paralelizar produziria falha
	 * intermitente que ninguém consegue reproduzir.
	 */
	fullyParallel: false,
	workers: 1,

	// Retentativa só no CI: localmente um teste instável precisa ser visto
	// falhando, não escondido por uma segunda tentativa.
	retries: process.env.CI ? 2 : 1,
	forbidOnly: Boolean(process.env.CI),

	reporter: [
		["list"],
		["html", { outputFolder: "reports/html", open: "never" }],
		["json", { outputFile: "reports/results.json" }],
		// Relatório operacional da conferência — ver src/reporters/CsvReporter.ts.
		["./src/reporters/CsvReporter.ts"],
	],

	use: {
		baseURL: process.env.WEB_BASE_URL ?? "http://localhost:3000",
		// `retain-on-failure` e não `on`: trace de execução verde é lixo de disco,
		// e o de falha é exatamente o que se quer abrir depois.
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
		actionTimeout: 15_000,
		locale: "pt-BR",
		timezoneId: "America/Sao_Paulo",
	},

	projects: [
		{
			name: "chromium-headless",
			use: { ...devices["Desktop Chrome"], headless: true },
		},
		{
			name: "chromium-headed",
			// `slowMo` deixa a execução acompanhável por uma pessoa — é o modo de
			// acompanhar o fluxo na tela, não o de rodar no pipeline.
			use: { ...devices["Desktop Chrome"], headless: false, launchOptions: { slowMo: 300 } },
		},
	],

	outputDir: "test-results",
});
