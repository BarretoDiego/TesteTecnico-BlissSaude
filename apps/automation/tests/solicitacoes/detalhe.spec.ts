/**
 * Detalhe da solicitação — `GET /requests/{id}` e `GET /reviews/{id}/timeline`.
 *
 * A trilha é o que prova quem conferiu o quê e quando, e vem de **outro**
 * microserviço. Recarregá-la sem recarregar a página é o único ponto do sistema
 * onde as duas Lambdas aparecem na mesma tela — e é o que estes testes cercam.
 */

import { expect, test } from "~/fixtures/test";

test.describe("detalhe da solicitação", () => {
	test("exibe os campos conforme a API devolve", async ({ authenticated, requestDetailPage, api, seedRequests }) => {
		const [request] = await seedRequests({ count: 1, priority: "critical" });
		const fromApi = await api.getRequest(request!.id);

		await requestDetailPage.goto(request!.id);

		await expect(requestDetailPage.container).toBeVisible();
		await expect(requestDetailPage.title).toHaveText(fromApi.title);
		await expect(requestDetailPage.createdBy).toHaveText(fromApi.createdBy);
		// Ainda não conferida: o traço é o que a tela mostra no lugar do vazio.
		await expect(requestDetailPage.reviewedBy).toHaveText("—");
	});

	test("abrir pela linha da listagem leva ao detalhe daquela solicitação", async ({
		authenticated,
		requestsListPage,
		requestDetailPage,
		seedRequests,
		runId,
	}) => {
		const seeded = await seedRequests({ count: 2 });
		const alvo = seeded[1]!;

		await requestsListPage.goto({ createdBy: `conferencia+${runId}@saudebliss.test` });
		await requestsListPage.openRequest(alvo.id);

		// Clicar na segunda linha e cair na primeira é o defeito clássico de tabela
		// com chave errada — daí afirmar o id, e não só que abriu algum detalhe.
		await expect(requestDetailPage.container).toHaveAttribute("data-request-id", alvo.id);
		await expect(requestDetailPage.title).toHaveText(alvo.title);
	});

	test("recarregar a trilha traz a conferência feita por outra pessoa", async ({
		authenticated,
		requestDetailPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });

		await requestDetailPage.goto(request!.id);
		await expect(requestDetailPage.timelineEvents).toHaveCount(1);

		// O cenário real: alguém confere noutra aba enquanto esta continua aberta.
		await api.reviewRequest(request!.id, {
			reviewedBy: process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test",
			status: "reviewed",
		});

		await requestDetailPage.refreshTimeline.click();

		// Sem recarregar a página: é `GET /reviews/{id}/timeline` sozinho trazendo
		// o evento novo.
		await expect(requestDetailPage.timelineEvents).toHaveCount(2);
		await expect(requestDetailPage.eventoDoTipo("reviewed")).toBeVisible();
	});

	test("a trilha registra a rejeição com a transição de status", async ({
		authenticated,
		requestDetailPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await api.reviewRequest(request!.id, {
			reviewedBy: process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test",
			status: "rejected",
		});

		await requestDetailPage.goto(request!.id);

		// Rejeitar grava um evento de conferência: o desfecho está no status para o
		// qual ela transitou, não num tipo de evento próprio.
		await expect(requestDetailPage.eventoComDesfecho("rejected")).toBeVisible();
		await expect(requestDetailPage.reviewedBy).toHaveText(
			process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test"
		);
	});

	test("voltar retorna para a listagem", async ({ authenticated, requestDetailPage, requestsListPage, seedRequests }) => {
		const [request] = await seedRequests({ count: 1 });

		await requestDetailPage.goto(request!.id);
		await requestDetailPage.backLink.click();

		await requestsListPage.waitForQuery();
		await expect(requestsListPage.page).toHaveURL(/\/solicitacoes$/);
	});
});
