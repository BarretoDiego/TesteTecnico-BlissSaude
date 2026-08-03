/**
 * A conferência feita do celular.
 *
 * Não é o cenário hipotético: quem confere costuma estar longe da mesa quando
 * precisa liberar uma solicitação urgente. O fluxo é o mesmo da suíte de
 * desktop, mas executado por **toque** e com o modal medido contra a viewport —
 * ele assumia 448px de largura fixa e saía pela borda de qualquer celular.
 */

import { expect, test } from "~/fixtures/test";
import { esperarAlcancavelPeloToque, esperarDentroDaViewport, esperarSemRolagemHorizontal } from "~/support/layout";

test.describe("conferência pelo celular", () => {
	test("confere uma solicitação inteiramente por toque", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		const botao = conferenciaPage.page.getByTestId(`conferencia-mark-reviewed-${request!.id}`);
		await esperarAlcancavelPeloToque(botao, "o botão de revisar da linha");
		await botao.tap();

		await conferenciaPage.confirmDialog.waitFor({ state: "visible" });
		await conferenciaPage.page.getByTestId("confirm-dialog-confirm").tap();
		await conferenciaPage.rowById(request!.id).waitFor({ state: "detached" });

		// O oráculo, igual ao desktop: a linha sumir da fila poderia ser só efeito
		// visual de uma tela estreita.
		const fromApi = await api.getRequest(request!.id);
		expect(fromApi.status).toBe("reviewed");
	});

	test("o modal de confirmação cabe na tela e mostra qual solicitação será conferida", async ({
		authenticated,
		conferenciaPage,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		await conferenciaPage.page.getByTestId(`conferencia-mark-reviewed-${request!.id}`).tap();
		await conferenciaPage.confirmDialog.waitFor({ state: "visible" });

		await esperarDentroDaViewport(conferenciaPage.confirmDialog, "o modal de confirmação");

		// Confirmar às cegas é o risco de tela pequena: o texto que nomeia a
		// solicitação precisa continuar legível, e os dois botões alcançáveis.
		await expect(conferenciaPage.page.getByTestId("confirm-dialog-description")).toContainText(request!.title);
		await esperarAlcancavelPeloToque(conferenciaPage.page.getByTestId("confirm-dialog-confirm"), "o botão confirmar");
		await esperarAlcancavelPeloToque(conferenciaPage.page.getByTestId("confirm-dialog-cancel"), "o botão cancelar");
	});

	test("cancelar no celular não registra a conferência", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		await conferenciaPage.page.getByTestId(`conferencia-mark-reviewed-${request!.id}`).tap();
		await conferenciaPage.confirmDialog.waitFor({ state: "visible" });
		await conferenciaPage.page.getByTestId("confirm-dialog-cancel").tap();
		await conferenciaPage.confirmDialog.waitFor({ state: "hidden" });

		await expect(conferenciaPage.rowById(request!.id)).toBeVisible();
		expect((await api.getRequest(request!.id)).status).toBe("open");
	});

	test("a fila continua paginável em tela estreita", async ({ authenticated, conferenciaPage, seedRequests }) => {
		await seedRequests({ count: 3 });

		await conferenciaPage.goto({ pageSize: 2 });
		expect(await conferenciaPage.snapshotRows()).toHaveLength(2);
		await esperarSemRolagemHorizontal(conferenciaPage.page);

		await conferenciaPage.mudarConsulta(() => conferenciaPage.page.getByTestId("pagination-next").tap());

		expect((await conferenciaPage.snapshotRows()).length).toBeGreaterThan(0);
	});
});
