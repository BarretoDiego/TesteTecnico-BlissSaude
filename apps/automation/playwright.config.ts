/**
 * Configuração do Playwright.
 *
 * Quatro projects em duas famílias:
 *
 * - **desktop** (`chromium-headless`, `chromium-headed`) — a suíte inteira menos
 *   `tests/mobile/`. Headless e headed são o mesmo conjunto: o modo de execução
 *   vira escolha de linha de comando, em vez de uma variável de ambiente que
 *   alguém esquece de definir.
 * - **mobile** (`mobile-chrome`, `mobile-safari`) — só `tests/mobile/`, com
 *   emulação de dispositivo e eventos de toque.
 *
 * Rodar a suíte inteira nos quatro seria a escolha errada: metade do que ela
 * verifica é regra de negócio, que não muda com a largura da tela, e o preço
 * seria dobrar o tempo para reexecutar a mesma asserção. `tests/mobile/` cobre o
 * que **só** falha em tela estreita — transbordo horizontal, alvo de toque
 * coberto por outro elemento, modal maior que a viewport — sobre os mesmos
 * fluxos críticos.
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
			testIgnore: /tests\/mobile\//,
			use: { ...devices["Desktop Chrome"], headless: true },
		},
		{
			name: "chromium-headed",
			testIgnore: /tests\/mobile\//,
			// `slowMo` deixa a execução acompanhável por uma pessoa — é o modo de
			// acompanhar o fluxo na tela, não o de rodar no pipeline.
			use: { ...devices["Desktop Chrome"], headless: false, launchOptions: { slowMo: 300 } },
		},

		/**
		 * Android de tela pequena. `devices["Pixel 5"]` traz junto o que faz a
		 * emulação valer: viewport de 393px, `deviceScaleFactor`, user agent móvel
		 * e — o que mais importa aqui — `hasTouch`, que troca os eventos de mouse
		 * por eventos de toque. Um alvo coberto por outro elemento só falha assim.
		 */
		{
			name: "mobile-chrome",
			testMatch: /tests\/mobile\//,
			use: { ...devices["Pixel 5"] },
		},

		/**
		 * iPhone, com o motor do Safari de verdade (WebKit).
		 *
		 * Não é redundante com o Pixel: a barra de endereço do iOS muda a altura
		 * visível durante a rolagem, o `<dialog>` nativo tem histórico próprio de
		 * divergência, e é o WebKit que decide o zoom automático em campo de
		 * formulário. Diferenças que emulação sobre Chromium não reproduz.
		 */
		{
			name: "mobile-safari",
			testMatch: /tests\/mobile\//,
			use: { ...devices["iPhone 13"] },
		},
	],

	outputDir: "test-results",
});
