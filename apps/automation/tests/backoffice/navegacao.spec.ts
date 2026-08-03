/**
 * Navegação e sessão — a casca que envolve todas as telas.
 *
 * Os testes de fluxo chegam a cada tela pela URL, que é o caminho curto. O preço
 * é que ninguém verifica o menu: um item apontando para a rota errada, ou
 * coberto por outro elemento, não apareceria em teste algum. Aqui a navegação é
 * sempre **pelo clique**.
 *
 * A sessão entra pelo mesmo motivo: o guarda de rota é de conveniência — quem
 * protege de fato é o authorizer na borda — mas é ele que evita a tela cheia de
 * erro de rede para quem não está autenticado, e ninguém o exercitava.
 */

import { AUTOMATION_USER, expect, test } from "~/fixtures/test";

test.describe("navegação pelo menu", () => {
	test("o menu leva às três telas do backoffice", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();

		await shell.irPara("conferencia");
		await expect(shell.page).toHaveURL(/\/conferencia/);

		await shell.irPara("status");
		await expect(shell.page).toHaveURL(/\/status/);

		await shell.irPara("solicitacoes");
		await expect(shell.page).toHaveURL(/\/solicitacoes/);
	});

	test("o item ativo acompanha a tela aberta", async ({ authenticated, shell, conferenciaPage }) => {
		await conferenciaPage.goto();
		expect(await shell.secaoAtiva()).toBe("conferencia");

		await shell.irPara("status");
		expect(await shell.secaoAtiva()).toBe("status");
	});

	test("o botão de nova solicitação leva ao formulário", async ({
		authenticated,
		requestsListPage,
		novaSolicitacaoPage,
	}) => {
		await requestsListPage.goto();
		await requestsListPage.page.getByTestId("nova-solicitacao").click();

		await expect(novaSolicitacaoPage.form).toBeVisible();
		await expect(novaSolicitacaoPage.page).toHaveURL(/\/solicitacoes\/nova/);
	});
});

test.describe("sessão", () => {
	test("sair encerra a sessão e devolve ao login", async ({ authenticated, shell, loginPage }) => {
		await shell.page.goto("/solicitacoes");
		await shell.logout.click();

		await expect(loginPage.page).toHaveURL(/\/login/);
		await expect(loginPage.page.getByTestId("login-form")).toBeVisible();
	});

	test("depois de sair, a rota protegida não volta a abrir", async ({ authenticated, shell }) => {
		await shell.page.goto("/solicitacoes");
		await shell.logout.click();
		await expect(shell.page).toHaveURL(/\/login/);

		// Voltar pela URL é o que alguém faz sem pensar — e o token já não existe.
		await shell.page.goto("/conferencia");
		await expect(shell.page).toHaveURL(/\/login/);
	});

	test("rota protegida sem sessão redireciona para o login", async ({ page }) => {
		// Sem a fixture `authenticated` de propósito: é o navegador limpo chegando
		// direto numa rota interna, por link compartilhado ou favorito.
		await page.goto("/conferencia");

		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByTestId("login-form")).toBeVisible();
	});

	test("a sessão sobrevive à recarga da página", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();
		await requestsListPage.page.reload();
		await requestsListPage.waitForQuery();

		// A sessão vive fora da memória do React — recarregar não deveria deslogar
		// quem está no meio de uma conferência.
		await expect(shell.currentUser).toBeVisible();
		await expect(requestsListPage.page).toHaveURL(/\/solicitacoes/);
	});

	test("autenticar de novo devolve o backoffice para o mesmo usuário", async ({ loginPage, shell }) => {
		await loginPage.loginAndWait(AUTOMATION_USER.email, AUTOMATION_USER.password);
		await shell.logout.click();
		await expect(loginPage.page).toHaveURL(/\/login/);

		await loginPage.loginAndWait(AUTOMATION_USER.email, AUTOMATION_USER.password);
		await expect(shell.currentUser).toBeVisible();
	});
});

test.describe("perfil", () => {
	test("o modal traz a identidade que a API reconhece agora", async ({ authenticated, shell, api }) => {
		await shell.page.goto("/solicitacoes");
		await shell.abrirPerfil();

		// O oráculo: o modal consulta `GET /auth/me` a cada abertura justamente
		// para não exibir o que veio no login, que pode estar velho.
		const me = await api.me();
		await expect(shell.profileName).toHaveText(me.name);
		await expect(shell.profileEmail).toHaveText(me.email);
		await expect(shell.profileId).toHaveText(me.id);
		expect(await shell.perfisExibidos()).toEqual(me.roles);
	});

	test("fechar pelo botão devolve a tela por baixo", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();
		await shell.abrirPerfil();
		await shell.profileClose.click();

		await expect(shell.profileDialog).toBeHidden();
		await expect(requestsListPage.rows.first().or(requestsListPage.emptyState)).toBeVisible();
	});

	test("Esc fecha o modal", async ({ authenticated, shell }) => {
		await shell.page.goto("/solicitacoes");
		await shell.abrirPerfil();

		// `Esc` vem do `<dialog>` nativo — e é a razão de a tela usá-lo em vez de
		// uma div posicionada, que exigiria reimplementar isto e quase sempre erra.
		await shell.page.keyboard.press("Escape");
		await expect(shell.profileDialog).toBeHidden();
	});

	test("sair pelo modal encerra a sessão", async ({ authenticated, shell, loginPage }) => {
		await shell.page.goto("/solicitacoes");
		await shell.abrirPerfil();
		await shell.profileLogout.click();

		await expect(loginPage.page).toHaveURL(/\/login/);
	});
});
