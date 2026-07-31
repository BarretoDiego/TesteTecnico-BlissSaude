/**
 * @module automation/fixtures/test
 *
 * Fixtures da suíte.
 *
 * Duas responsabilidades: autenticar uma vez por teste e **semear os próprios
 * dados**. Depender do que já estiver no banco torna o resultado função da ordem
 * de execução — e é o que faz uma suíte passar na máquina de quem escreveu e
 * falhar no pipeline.
 */

import { test as base } from "@playwright/test";
import type { CreateRequestPayload, Request as RequestDto } from "@saude-bliss/contracts";
import { randomUUID } from "node:crypto";
import { ApiClient } from "~/api/ApiClient";
import { ConferenciaPage } from "~/pages/ConferenciaPage";
import { LoginPage } from "~/pages/LoginPage";
import { RequestDetailPage } from "~/pages/RequestDetailPage";
import { RequestsListPage } from "~/pages/RequestsListPage";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000/v1";
const EMAIL = process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test";
const PASSWORD = process.env.AUTOMATION_PASSWORD ?? "saudebliss123";

export interface SeedOptions {
	count?: number;
	priority?: CreateRequestPayload["priority"];
}

export interface Fixtures {
	api: ApiClient;
	/**
	 * Marca única desta execução.
	 *
	 * Cada teste semeia com um `createdBy` derivado dela e filtra por ele. É o que
	 * torna a retentativa segura: uma segunda tentativa não enxerga os dados da
	 * primeira, e execuções concorrentes não colidem.
	 */
	runId: string;
	seedRequests: (options?: SeedOptions) => Promise<RequestDto[]>;
	loginPage: LoginPage;
	requestsListPage: RequestsListPage;
	requestDetailPage: RequestDetailPage;
	conferenciaPage: ConferenciaPage;
	/** Backoffice já autenticado. */
	authenticated: void;
}

export const test = base.extend<Fixtures>({
	runId: async ({}, use) => {
		await use(randomUUID().slice(0, 8));
	},

	api: async ({}, use) => {
		const client = await ApiClient.create(API_BASE_URL, EMAIL, PASSWORD);
		await use(client);
		await client.dispose();
	},

	seedRequests: async ({ api, runId }, use) => {
		let sequence = 0;

		await use(async (options: SeedOptions = {}) => {
			const count = options.count ?? 1;
			const created: RequestDto[] = [];

			for (let index = 0; index < count; index += 1) {
				sequence += 1;
				created.push(
					await api.createRequest({
						title: `Conferência automatizada ${runId} #${sequence}`,
						description: `Solicitação semeada pela automação na execução ${runId} para exercitar a conferência.`,
						priority: options.priority ?? "high",
						createdBy: `conferencia+${runId}@saudebliss.test`,
					})
				);
			}

			return created;
		});
	},

	loginPage: async ({ page }, use) => use(new LoginPage(page)),
	requestsListPage: async ({ page }, use) => use(new RequestsListPage(page)),
	requestDetailPage: async ({ page }, use) => use(new RequestDetailPage(page)),
	conferenciaPage: async ({ page }, use) => use(new ConferenciaPage(page)),

	authenticated: async ({ loginPage }, use) => {
		await loginPage.loginAndWait(EMAIL, PASSWORD);
		await use();
	},
});

export { expect } from "@playwright/test";
export const AUTOMATION_USER = { email: EMAIL, password: PASSWORD };
