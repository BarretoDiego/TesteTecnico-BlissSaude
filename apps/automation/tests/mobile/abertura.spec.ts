/**
 * Abertura de solicitação pelo celular.
 *
 * Formulário é onde tela pequena costuma falhar de formas específicas: campo que
 * sai da área visível ao abrir o teclado, botão de enviar coberto, mensagem de
 * erro renderizada fora do campo. Os testes aqui percorrem o formulário inteiro
 * por toque e digitação, e conferem o resultado contra a API.
 */

import { expect, test } from "~/fixtures/test";
import { esperarAlcancavelPeloToque, esperarSemRolagemHorizontal } from "~/support/layout";

const DESCRICAO = "Solicitação aberta pela automação em tela de celular, para exercitar o formulário ao toque.";

test.describe("abertura pelo celular", () => {
	test("abre uma solicitação preenchendo o formulário ao toque", async ({
		authenticated,
		novaSolicitacaoPage,
		api,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await esperarSemRolagemHorizontal(novaSolicitacaoPage.page);

		await novaSolicitacaoPage.title.tap();
		await novaSolicitacaoPage.title.fill(`Aberta do celular ${runId}`);
		await novaSolicitacaoPage.description.tap();
		await novaSolicitacaoPage.description.fill(DESCRICAO);
		await novaSolicitacaoPage.priority.selectOption("high");
		await novaSolicitacaoPage.createdBy.fill(`conferencia+${runId}@saudebliss.test`);

		await esperarAlcancavelPeloToque(novaSolicitacaoPage.submit, "o botão de abrir solicitação");
		await novaSolicitacaoPage.submit.tap();

		const id = await novaSolicitacaoPage.createdId();
		const fromApi = await api.getRequest(id);
		expect(fromApi.title).toBe(`Aberta do celular ${runId}`);
		expect(fromApi.priority).toBe("high");
	});

	test("o erro de validação aparece junto do campo, sem estourar a tela", async ({
		authenticated,
		novaSolicitacaoPage,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: "ab",
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});

		await expect(novaSolicitacaoPage.fieldError("title")).toBeVisible();
		// Mensagem de erro é conteúdo novo entre campos: em tela estreita é onde um
		// texto sem quebra empurra o formulário para fora da largura.
		await esperarSemRolagemHorizontal(novaSolicitacaoPage.page);
	});

	test("a confirmação mostra id e trace por inteiro na largura do celular", async ({
		authenticated,
		novaSolicitacaoPage,
		runId,
	}) => {
		await novaSolicitacaoPage.goto();
		await novaSolicitacaoPage.fillAndSubmit({
			title: `Confirmação no celular ${runId}`,
			description: DESCRICAO,
			createdBy: `conferencia+${runId}@saudebliss.test`,
		});

		await expect(novaSolicitacaoPage.sucesso).toBeVisible();
		// UUID e trace não têm onde quebrar: é o conteúdo que mais estoura coluna.
		await esperarSemRolagemHorizontal(novaSolicitacaoPage.page);
		await esperarAlcancavelPeloToque(novaSolicitacaoPage.verDetalhe, "o link para o detalhe");
	});
});
