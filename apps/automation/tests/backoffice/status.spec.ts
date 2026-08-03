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

	test("verificar novamente sonda os três serviços de novo", async ({ authenticated, statusPage }) => {
		await statusPage.goto();

		/**
		 * A asserção é sobre a **rede**, não sobre o horário exibido.
		 *
		 * O horário sai com precisão de segundo: duas verificações seguidas contra
		 * uma API local — que responde em milissegundos — produzem exatamente o
		 * mesmo texto, e o teste falharia sem nada estar errado. Contar as sondas
		 * responde à pergunta real: o botão refez a consulta?
		 */
		const sondas: string[] = [];
		statusPage.page.on("request", (request) => {
			if (request.url().includes("/health")) sondas.push(new URL(request.url()).pathname);
		});

		await statusPage.recheck.click();
		await statusPage.waitForCheck();

		await expect
			.poll(() => new Set(sondas).size, { message: "os três serviços deveriam ser sondados de novo" })
			.toBe(3);
		expect(await statusPage.allUp()).toBe(true);
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
