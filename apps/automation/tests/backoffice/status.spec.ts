/**
 * Status dos serviços — as rotas que nenhum outro fluxo toca.
 *
 * Os três `/health` e o `GET /auth/me` só aparecem aqui. Sem esta suíte, uma
 * Lambda fora do ar ou um `/health` quebrado só seria descoberto quando um teste
 * de negócio falhasse por um motivo que não é o dele — e o diagnóstico custaria
 * a leitura de um trace inteiro para chegar em "o serviço não subiu".
 */

import { expect, test } from "~/fixtures/test";
import { SERVICOS } from "~/pages/StatusPage";

test.describe("status dos serviços", () => {
	test("as três sondas respondem ok", async ({ authenticated, statusPage }) => {
		await statusPage.goto();

		for (const servico of SERVICOS) {
			await expect(statusPage.row(servico), `${servico} deveria aparecer na tela`).toBeVisible();
			await expect(statusPage.row(servico)).toHaveAttribute("data-reachable", "true");
			await expect(statusPage.badge(servico)).toHaveText("ok");
		}

		expect(await statusPage.allUp(), "a tela deveria reconhecer a malha inteira no ar").toBe(true);
	});

	test("a identidade exibida é a que a API devolve", async ({ authenticated, statusPage, api }) => {
		await statusPage.goto();

		const me = await api.me();
		await expect(statusPage.identidadeNome).toHaveText(me.name);
		await expect(statusPage.identidadeEmail).toHaveText(me.email);
		await expect(statusPage.identidadePerfis).toHaveText(me.roles.join(", "));
	});

	test("verificar novamente refaz a sondagem", async ({ authenticated, statusPage }) => {
		await statusPage.goto();
		const antes = await statusPage.checkedAt();

		await statusPage.recheck.click();
		// O botão desabilitado durante a consulta é o que impede uma fila de
		// sondagens sobrepostas com um clique impaciente.
		await expect(statusPage.recheck).toBeDisabled();
		await statusPage.waitForCheck();

		await expect
			.poll(() => statusPage.checkedAt(), { message: "o horário da verificação deveria mudar" })
			.not.toBe(antes);
	});

	test("cada linha mostra a rota sondada", async ({ authenticated, statusPage }) => {
		await statusPage.goto();

		// A rota na tela é o que permite reproduzir a sonda no terminal quando algo
		// está fora — sem ela, "bliss-reviews: fora" não diz onde bater.
		for (const servico of SERVICOS) {
			await expect(statusPage.row(servico)).toContainText("/health");
		}
	});
});
