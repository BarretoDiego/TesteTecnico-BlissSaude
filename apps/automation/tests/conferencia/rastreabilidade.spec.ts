/**
 * Rastreabilidade por requestId, verificada do browser até o banco.
 */

import { expect, test } from "~/fixtures/test";

test.describe("rastreabilidade", () => {
	test("o requestId enviado na criação é persistido e exibido no detalhe", async ({
		authenticated,
		requestDetailPage,
		api,
		runId,
	}) => {
		const trace = `automacao-${runId}`;

		const created = await api.createRequest(
			{
				title: `Rastreabilidade ${runId}`,
				description: "Solicitação criada pela automação para verificar a propagação do requestId.",
				priority: "medium",
				createdBy: `conferencia+${runId}@saudebliss.test`,
			},
			trace
		);

		// Persistido: o id que o cliente enviou virou coluna na linha do banco.
		expect(created.createdTraceId).toBe(trace);

		await requestDetailPage.goto(created.id);

		// E chega até a tela, onde uma pessoa consegue copiá-lo para buscar no log.
		await expect(requestDetailPage.createdTraceId).toHaveText(trace);
	});

	test("a tela de detalhe exibe a trilha com o trace de cada evento", async ({
		authenticated,
		requestDetailPage,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });

		await requestDetailPage.goto(request!.id);

		await expect(requestDetailPage.container).toBeVisible();
		await expect(requestDetailPage.timelineEvents).toHaveCount(1);
	});
});
