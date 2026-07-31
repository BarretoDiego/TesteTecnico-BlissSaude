/**
 * Filtros da listagem — o requisito `GET /requests?createdBy=&status=` visto
 * pela tela.
 *
 * Cada teste semeia os próprios dados e filtra por eles, então o resultado não
 * depende do que já existe no banco.
 */

import { expect, test } from "~/fixtures/test";

test.describe("filtros da listagem", () => {
	test("filtra por solicitante e retorna somente as solicitações dele", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		const seeded = await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy });
		const rows = await requestsListPage.snapshotRows();

		expect(rows).toHaveLength(seeded.length);
		expect(rows.every((row) => row.createdBy === createdBy)).toBe(true);
	});

	test("filtra por status", async ({ authenticated, requestsListPage, seedRequests, runId }) => {
		await seedRequests({ count: 2 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, status: "open" });
		const rows = await requestsListPage.snapshotRows();

		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.status === "open")).toBe(true);
	});

	test("combina os filtros de status e solicitante", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 2, priority: "critical" });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, status: "open", priority: "critical" });
		const rows = await requestsListPage.snapshotRows();

		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.status === "open" && row.priority === "critical")).toBe(true);
	});

	test("exibe estado vazio quando o filtro não retorna resultados", async ({ authenticated, requestsListPage }) => {
		await requestsListPage.goto({ createdBy: "ninguem-com-este-email@saudebliss.test" });

		await expect(requestsListPage.emptyState).toBeVisible();
		await expect(requestsListPage.rows).toHaveCount(0);
	});

	test("o filtro sobrevive à recarga porque vive na URL", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 1 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy });
		await requestsListPage.page.reload();
		// A recarga precisa da mesma espera do `goto`: sem ela a leitura acontece
		// enquanto a tela ainda mostra o resultado anterior.
		await requestsListPage.waitForQuery({ createdBy });

		// Estado em `useState` se perderia aqui — é a razão de ele morar na URL.
		const rows = await requestsListPage.snapshotRows();
		expect(rows.every((row) => row.createdBy === createdBy)).toBe(true);
	});
});
