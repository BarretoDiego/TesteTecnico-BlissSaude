/**
 * Listagem — paginação e os controles de filtro da própria tela.
 *
 * A suíte de filtros existente chega ao estado filtrado **pela URL**, que é o
 * caminho curto e o certo para a maioria dos testes. O preço é que ela nunca
 * exercita os controles: um `<select>` que parasse de escrever no endereço
 * passaria despercebido, porque todo teste já chegaria pronto ao estado que ele
 * deveria produzir. É essa metade que fica aqui.
 *
 * A paginação é verificada com `pageSize=1` sobre os dados semeados pelo próprio
 * teste: três solicitações viram três páginas determinísticas, sem depender do
 * volume que houver no banco.
 */

import { expect, test } from "~/fixtures/test";

test.describe("paginação da listagem", () => {
	test("o total exibido é o mesmo que a API devolve", async ({
		authenticated,
		requestsListPage,
		api,
		seedRequests,
		runId,
	}) => {
		const seeded = await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1" });

		const daTela = await requestsListPage.paginationState();
		const daApi = await api.listRequests({ createdBy, pageSize: 1 });

		expect(daTela.total).toBe(daApi.pagination.total);
		expect(daTela.total).toBe(seeded.length);
		expect(daTela.totalPages).toBe(seeded.length);
	});

	test("navegar para a próxima página troca as solicitações exibidas", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1" });
		const [primeira] = await requestsListPage.snapshotRows();

		await requestsListPage.irParaProximaPagina();
		const [segunda] = await requestsListPage.snapshotRows();

		expect(segunda!.id, "a segunda página deveria trazer outra solicitação").not.toBe(primeira!.id);
		expect((await requestsListPage.paginationState()).page).toBe(2);

		// E voltar traz de volta a mesma linha: sem desempate estável na ordenação,
		// ir e voltar pode mostrar registros diferentes.
		await requestsListPage.irParaPaginaAnterior();
		const [deVolta] = await requestsListPage.snapshotRows();
		expect(deVolta!.id).toBe(primeira!.id);
	});

	test("o resumo descreve a faixa de itens da página atual", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1" });
		await expect(requestsListPage.paginationSummary).toHaveText("1–1 de 3");

		await requestsListPage.irParaProximaPagina();
		await expect(requestsListPage.paginationSummary).toHaveText("2–2 de 3");
	});

	test("os extremos desabilitam anterior e próxima", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 2 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1" });
		await expect(requestsListPage.previousPage).toBeDisabled();
		await expect(requestsListPage.nextPage).toBeEnabled();

		await requestsListPage.irParaProximaPagina();
		await expect(requestsListPage.previousPage).toBeEnabled();
		await expect(requestsListPage.nextPage).toBeDisabled();
	});

	test("clicar no número leva direto àquela página", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1" });
		await requestsListPage.irParaPagina(3);

		expect((await requestsListPage.paginationState()).page).toBe(3);
		await expect(requestsListPage.rows).toHaveCount(1);
	});

	test("trocar o tamanho da página volta para a primeira", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1", page: "3" });
		expect((await requestsListPage.paginationState()).page).toBe(3);

		await requestsListPage.escolherTamanhoDePagina(20);

		// Manter `page=3` ao passar de 1 para 20 por página cairia numa página que
		// deixou de existir — e a tela mostraria vazio com dados no banco.
		const estado = await requestsListPage.paginationState();
		expect(estado.page).toBe(1);
		expect(estado.pageSize).toBe(20);
		expect(requestsListPage.searchParams().get("page"), "o parâmetro de página deveria sair da URL").toBeNull();
	});

	test("a página escolhida sobrevive à recarga porque vive na URL", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1", page: "2" });
		const [antes] = await requestsListPage.snapshotRows();

		await requestsListPage.page.reload();
		await requestsListPage.waitForQuery({ createdBy, pageSize: "1", page: "2" });

		const [depois] = await requestsListPage.snapshotRows();
		expect(depois!.id).toBe(antes!.id);
	});
});

test.describe("filtros pelos controles da tela", () => {
	test("selecionar o status escreve o filtro na URL e restringe a listagem", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 2 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy });
		await requestsListPage.selecionarStatus("open");

		expect(requestsListPage.searchParams().get("status")).toBe("open");
		const rows = await requestsListPage.snapshotRows();
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.status === "open")).toBe(true);
	});

	test("selecionar a prioridade filtra pelo controle da tela", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 2, priority: "critical" });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy });
		await requestsListPage.selecionarPrioridade("critical");

		expect(requestsListPage.searchParams().get("priority")).toBe("critical");
		const rows = await requestsListPage.snapshotRows();
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.priority === "critical")).toBe(true);
	});

	test("digitar o solicitante só filtra ao sair do campo", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		const seeded = await seedRequests({ count: 2 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto();
		await requestsListPage.filterCreatedBy.fill(createdBy);

		// Ainda sem `blur`: filtrar a cada tecla dispararia uma requisição por
		// caractere digitado, e é por isso que a tela espera o campo perder o foco.
		expect(requestsListPage.searchParams().get("createdBy"), "não deveria filtrar enquanto digita").toBeNull();

		await requestsListPage.digitarSolicitante(createdBy);

		expect(requestsListPage.searchParams().get("createdBy")).toBe(createdBy);
		const rows = await requestsListPage.snapshotRows();
		expect(rows).toHaveLength(seeded.length);
	});

	test("limpar remove todos os filtros da URL", async ({ authenticated, requestsListPage, seedRequests, runId }) => {
		await seedRequests({ count: 1 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, status: "open" });
		await requestsListPage.limparFiltros();

		const params = requestsListPage.searchParams();
		expect(params.get("createdBy")).toBeNull();
		expect(params.get("status")).toBeNull();
	});

	test("trocar de filtro reinicia a paginação", async ({ authenticated, requestsListPage, seedRequests, runId }) => {
		await seedRequests({ count: 3 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy, pageSize: "1", page: "3" });
		await requestsListPage.selecionarStatus("open");

		// Sem isso, filtrar da página 3 cairia numa página vazia e pareceria que o
		// filtro não devolveu nada.
		expect(requestsListPage.searchParams().get("page")).toBeNull();
		expect((await requestsListPage.paginationState()).page).toBe(1);
	});

	test("voltar do navegador retorna à listagem filtrada", async ({
		authenticated,
		requestsListPage,
		requestDetailPage,
		seedRequests,
		runId,
	}) => {
		const seeded = await seedRequests({ count: 2 });
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await requestsListPage.goto({ createdBy });
		await requestsListPage.openRequest(seeded[0]!.id);
		await expect(requestDetailPage.container).toBeVisible();

		await requestsListPage.page.goBack();
		await requestsListPage.waitForQuery({ createdBy });

		// O filtro estar na URL é o que faz o botão voltar do navegador devolver a
		// tela como ela estava. Em `useState` ele voltaria para a listagem inteira.
		expect(requestsListPage.searchParams().get("createdBy")).toBe(createdBy);
		expect(await requestsListPage.snapshotRows()).toHaveLength(seeded.length);
	});
});
