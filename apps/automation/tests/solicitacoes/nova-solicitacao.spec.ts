/**
 * Abertura de solicitação — a tela de `POST /requests`.
 *
 * O que faz esta suíte valer mais que "preencher e clicar" são duas coisas.
 *
 * A primeira: toda criação é conferida contra a API. Uma tela pode exibir a
 * confirmação com o dado que ela mesma digitou e o teste passaria mesmo se nada
 * tivesse sido gravado — o oráculo é o que separa um caso do outro.
 *
 * A segunda: a validação local usa o **mesmo** schema Zod da API, e é isso que a
 * suíte protege. Se o front deixar de validar, o campo inválido passa a viajar
 * até a API e a mensagem chega pelo caminho do erro; o teste que conta as
 * requisições é o único que enxerga essa regressão.
 */

import { expect, test } from "~/fixtures/test";

/** Descrição válida: o schema exige 10 caracteres. */
const DESCRICAO = "Descrição válida, criada pela automação para exercitar a abertura de solicitação.";

test.describe("abertura de solicitação", () => {
	test("abre a solicitação e a confirmação traz o id e o trace da criação", async ({
		authenticated,
		novaSolicitacaoPage,
		api,
		runId,
	}) => {
		const titulo = `Abertura pela tela ${runId}`;
		await novaSolicitacaoPage.goto();

		await novaSolicitacaoPage.fillAndSubmit({
			title: titulo,
			description: DESCRICAO,
			priority: "critical",
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});

		await expect(novaSolicitacaoPage.sucesso).toBeVisible();
		await expect(novaSolicitacaoPage.sucessoTitulo).toHaveText(titulo);

		// O oráculo: a confirmação poderia estar ecoando o que foi digitado.
		const id = await novaSolicitacaoPage.createdId();
		const fromApi = await api.getRequest(id);
		expect(fromApi.title).toBe(titulo);
		expect(fromApi.priority).toBe("critical");
		expect(fromApi.status).toBe("open");

		// E o trace exibido é o mesmo que ficou gravado na linha — é ele que liga a
		// solicitação às linhas de log.
		await expect(novaSolicitacaoPage.sucessoTrace).toHaveText(fromApi.createdTraceId ?? "");
		expect(fromApi.createdTraceId).toBeTruthy();
	});

	test("o campo do solicitante já vem com quem está logado", async ({ authenticated, novaSolicitacaoPage }) => {
		await novaSolicitacaoPage.goto();

		await expect(novaSolicitacaoPage.createdBy).toHaveValue(
			process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test"
		);
	});

	test("recusa título curto sem chegar a chamar a API", async ({ authenticated, novaSolicitacaoPage, runId }) => {
		const criacoes: string[] = [];
		novaSolicitacaoPage.page.on("request", (request) => {
			if (request.method() === "POST" && request.url().includes("/requests")) criacoes.push(request.url());
		});

		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: "ab",
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});

		await expect(novaSolicitacaoPage.fieldError("title")).toBeVisible();
		await expect(novaSolicitacaoPage.sucesso).toHaveCount(0);

		// A asserção que importa: a validação local barrou antes da rede. Sem ela o
		// teste passaria com o front tendo deixado de validar.
		expect(criacoes, "nenhum POST deveria ter saído com o formulário inválido").toEqual([]);
	});

	test("recusa descrição curta demais", async ({ authenticated, novaSolicitacaoPage, runId }) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: `Descrição curta ${runId}`,
			description: "curta",
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});

		await expect(novaSolicitacaoPage.fieldError("description")).toBeVisible();
		await expect(novaSolicitacaoPage.sucesso).toHaveCount(0);
	});

	test("recusa solicitante que não é e-mail", async ({ authenticated, novaSolicitacaoPage, runId }) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: `Solicitante inválido ${runId}`,
			description: DESCRICAO,
			createdBy: "nao-e-um-email",
		});

		await expect(novaSolicitacaoPage.fieldError("createdBy")).toBeVisible();
		await expect(novaSolicitacaoPage.sucesso).toHaveCount(0);
	});

	test("corrigir o campo inválido permite concluir a abertura", async ({
		authenticated,
		novaSolicitacaoPage,
		api,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: "ab",
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});
		await expect(novaSolicitacaoPage.fieldError("title")).toBeVisible();

		// O erro não pode ser terminal: quem errou um campo corrige e segue.
		await novaSolicitacaoPage.title.fill(`Título corrigido ${runId}`);
		await novaSolicitacaoPage.submit.click();

		const id = await novaSolicitacaoPage.createdId();
		expect((await api.getRequest(id)).title).toBe(`Título corrigido ${runId}`);
	});

	test("abrir outra limpa o formulário e permite uma segunda abertura", async ({
		authenticated,
		novaSolicitacaoPage,
		api,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: `Primeira ${runId}`,
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});
		const primeira = await novaSolicitacaoPage.createdId();

		await novaSolicitacaoPage.abrirOutra.click();
		await expect(novaSolicitacaoPage.form).toBeVisible();
		// Formulário limpo: reaproveitar o título anterior abriria uma duplicata sem
		// que ninguém percebesse.
		await expect(novaSolicitacaoPage.title).toHaveValue("");

		await novaSolicitacaoPage.fillAndSubmit({
			title: `Segunda ${runId}`,
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});
		const segunda = await novaSolicitacaoPage.createdId();

		expect(segunda).not.toBe(primeira);
		expect((await api.getRequest(segunda)).title).toBe(`Segunda ${runId}`);
	});

	test("ver a solicitação leva ao detalhe da que acabou de ser aberta", async ({
		authenticated,
		novaSolicitacaoPage,
		requestDetailPage,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: `Ir para o detalhe ${runId}`,
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});

		const id = await novaSolicitacaoPage.createdId();
		await novaSolicitacaoPage.verDetalhe.click();

		await expect(requestDetailPage.container).toBeVisible();
		await expect(requestDetailPage.container).toHaveAttribute("data-request-id", id);
		await expect(requestDetailPage.title).toHaveText(`Ir para o detalhe ${runId}`);
	});

	test("cancelar volta para a listagem sem abrir nada", async ({
		authenticated,
		novaSolicitacaoPage,
		requestsListPage,
		api,
		runId,
	}) => {
		const createdBy = `conferencia+${runId}@saudebliss.test`;

		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fill({ title: `Vai ser descartada ${runId}`, description: DESCRICAO, createdBy });
		await novaSolicitacaoPage.cancelar.click();

		await requestsListPage.waitForQuery();
		await expect(requestsListPage.page).toHaveURL(/\/solicitacoes$/);

		// A tela ter mudado não prova que nada foi gravado — a API prova.
		const doSolicitante = await api.listRequests({ createdBy });
		expect(doSolicitante.pagination.total, "cancelar não deveria abrir solicitação").toBe(0);
	});

	test("a solicitação aberta pela tela entra na fila de conferência", async ({
		authenticated,
		novaSolicitacaoPage,
		conferenciaPage,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: `Vai para a fila ${runId}`,
			description: DESCRICAO,
			priority: "high",
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});
		const id = await novaSolicitacaoPage.createdId();

		// O ciclo completo pela tela: abrir numa tela, conferir na outra. É o que
		// liga os dois microserviços do ponto de vista de quem opera.
		await conferenciaPage.goto();
		await expect(conferenciaPage.rowById(id)).toBeVisible();
	});
});
