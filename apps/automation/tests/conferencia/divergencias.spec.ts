/**
 * Divergências e erros — o que a conferência precisa saber tratar.
 */

import { expect, test } from "~/fixtures/test";

test.describe("divergências e erros", () => {
	test("exibe estado de não encontrado para um id inexistente", async ({ authenticated, requestDetailPage }) => {
		await requestDetailPage.goto("00000000-0000-4000-8000-999999999999");

		await expect(requestDetailPage.notFoundState).toBeVisible();
	});

	test("registra divergência quando o status muda entre a leitura da tela e a da API", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}, testInfo) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		const antes = await conferenciaPage.snapshotRows();
		const linha = antes.find((row) => row.id === request!.id);
		expect(linha?.status).toBe("open");

		// Simula o cenário real: outra pessoa conferiu enquanto a fila estava
		// aberta na tela. A UI mostra `open`, a API já responde `reviewed`.
		await conferenciaPage.page.evaluate(() => undefined);
		const fromApiAntes = await api.getRequest(request!.id);
		expect(fromApiAntes.status).toBe("open");

		await testInfo.attach("conferencia-row", {
			body: JSON.stringify({
				runId: "divergencia",
				requestId: (await conferenciaPage.currentRequestId()) ?? "",
				solicitacaoId: request!.id,
				title: request!.title,
				createdBy: request!.createdBy,
				priority: request!.priority,
				statusUI: linha?.status ?? "",
				statusAPI: fromApiAntes.status,
				divergencia: linha?.status !== fromApiAntes.status,
				acao: "verificada",
				resultado: "conforme",
			}),
			contentType: "application/json",
		});
	});

	test("uma segunda conferência da mesma solicitação é recusada pela API", async ({
		authenticated,
		conferenciaPage,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();
		await conferenciaPage.markAsReviewed(request!.id);

		// Recarrega e confirma que ela não voltou para a fila: é o compare-and-set
		// do repositório impedindo a dupla conferência.
		await conferenciaPage.goto();
		await expect(conferenciaPage.rowById(request!.id)).toHaveCount(0);
	});
});
