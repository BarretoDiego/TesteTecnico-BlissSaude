/**
 * Layout em tela de celular.
 *
 * Esta é a classe de defeito que nenhuma outra suíte enxerga: os dados estão
 * certos, a tela renderiza, todo fluxo passa — e mesmo assim o cabeçalho cobre o
 * botão de perfil e a página inteira rola para o lado. Os testes daqui medem
 * geometria, não conteúdo.
 *
 * O que eles travaram, concretamente: em 393px o cabeçalho somava 517px de
 * conteúdo numa linha só, a tabela de status estava sob `overflow-hidden` — com
 * três colunas inalcançáveis — e o `<dialog>` assumia 448px de largura fixa,
 * saindo pela borda da tela.
 */

import { expect, test } from "~/fixtures/test";
import { SECOES } from "~/pages/BackofficeShell";
import {
	esperarAlcancavelPeloToque,
	esperarDentroDaViewport,
	esperarRolagemPropria,
	esperarSemRolagemHorizontal,
} from "~/support/layout";

test.describe("layout em tela estreita", () => {
	test("a tela de login cabe na largura do celular", async ({ loginPage }) => {
		await loginPage.goto();

		await esperarSemRolagemHorizontal(loginPage.page);
		await expect(loginPage.page.getByTestId("login-submit")).toBeVisible();
	});

	test("nenhuma tela do backoffice rola horizontalmente", async ({
		authenticated,
		requestsListPage,
		conferenciaPage,
		statusPage,
		novaSolicitacaoPage,
	}) => {
		await requestsListPage.goto();
		await esperarSemRolagemHorizontal(requestsListPage.page);

		await conferenciaPage.goto();
		await esperarSemRolagemHorizontal(conferenciaPage.page);

		await statusPage.goto();
		await esperarSemRolagemHorizontal(statusPage.page);

		await novaSolicitacaoPage.goto();
		await esperarSemRolagemHorizontal(novaSolicitacaoPage.page);
	});

	test("o detalhe acomoda e-mail e uuid longos sem estourar a largura", async ({
		authenticated,
		requestDetailPage,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });

		await requestDetailPage.goto(request!.id);
		await expect(requestDetailPage.container).toBeVisible();

		// Item de grid nasce com `min-width: auto`: um e-mail ou um UUID — que não
		// têm onde quebrar — estouram a coluna e escrevem por cima da vizinha.
		await esperarSemRolagemHorizontal(requestDetailPage.page);
	});

	test("todos os itens do menu recebem o toque", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();

		for (const secao of SECOES) {
			await esperarAlcancavelPeloToque(shell.nav(secao), `o item de menu ${secao}`);
		}
	});

	test("o perfil e o sair não ficam cobertos pelo menu", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();

		// Foi exatamente isto que quebrava: o menu transbordava a linha do cabeçalho
		// e ficava por cima do botão de perfil, que continuava "visível" para o
		// Playwright e intocável para quem usa.
		await esperarAlcancavelPeloToque(shell.currentUser, "o botão de perfil");
		await esperarAlcancavelPeloToque(shell.logout, "o botão de sair");
	});

	test("navegar pelo menu funciona ao toque", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();

		await shell.nav("conferencia").tap();
		await expect(shell.page).toHaveURL(/\/conferencia/);

		await shell.nav("status").tap();
		await expect(shell.page).toHaveURL(/\/status/);
	});

	test("a tabela de solicitações rola dentro da própria moldura", async ({
		authenticated,
		requestsListPage,
		seedRequests,
		runId,
	}) => {
		await seedRequests({ count: 1 });
		await requestsListPage.goto({ createdBy: `conferencia+${runId}@saudebliss.test` });

		// Cinco colunas não cabem em 393px, e a saída certa é a moldura rolar — não
		// a página. As duas coisas precisam ser afirmadas juntas: sem a segunda,
		// esconder a tabela também passaria.
		await esperarRolagemPropria(requestsListPage.page.getByTestId("requests-table"), "a tabela de solicitações");
		await esperarSemRolagemHorizontal(requestsListPage.page);
	});

	test("a tabela de status alcança as colunas escondidas por rolagem", async ({ authenticated, statusPage }) => {
		await statusPage.goto();

		await esperarRolagemPropria(statusPage.table, "a tabela de status");

		// Com `overflow-hidden` as três últimas colunas — situação, ambiente e tempo
		// de resposta — eram inalcançáveis justamente para quem abre esta tela do
		// celular para saber o que caiu. Rolar até o fim precisa trazê-las à vista.
		await statusPage.table.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));

		await expect(statusPage.row("bliss-requests").locator("td").last()).toBeInViewport();
	});

	test("o perfil abre num modal que cabe na tela", async ({ authenticated, shell, requestsListPage }) => {
		await requestsListPage.goto();
		await shell.currentUser.tap();
		await shell.profileDialog.waitFor({ state: "visible" });

		await esperarDentroDaViewport(shell.profileDialog, "o modal de perfil");
		await esperarAlcancavelPeloToque(shell.profileClose, "o botão de fechar do perfil");
	});
});
