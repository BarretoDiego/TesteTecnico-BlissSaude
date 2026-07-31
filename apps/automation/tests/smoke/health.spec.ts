/**
 * Smoke — a suíte só faz sentido se estes dois passarem.
 *
 * Separados dos demais para que uma falha aqui seja lida como "o ambiente não
 * está de pé", e não como defeito da aplicação.
 */

import { expect, test } from "~/fixtures/test";

test.describe("smoke", () => {
	test("a API responde e devolve solicitações", async ({ api }) => {
		const result = await api.listRequests({ pageSize: 1 });

		expect(result.pagination.total).toBeGreaterThanOrEqual(0);
	});

	test("o backoffice carrega a tela de login", async ({ loginPage }) => {
		await loginPage.goto();

		await expect(loginPage.page.getByTestId("login-form")).toBeVisible();
	});

	test("autentica e chega ao backoffice", async ({ loginPage }) => {
		await loginPage.loginAndWait(
			process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test",
			process.env.AUTOMATION_PASSWORD ?? "saudebliss123"
		);

		await expect(loginPage.page.getByTestId("current-user")).toBeVisible();
	});

	test("recusa credencial inválida sem revelar qual campo errou", async ({ loginPage }) => {
		await loginPage.goto();
		await loginPage.login("daniel.morais@saudebliss.test", "senha-errada-123");

		// A mensagem é a mesma que um e-mail inexistente produz — é o que impede
		// usar o login como oráculo de enumeração de contas.
		await expect(loginPage.error).toBeVisible();
		await expect(loginPage.error).toContainText(/inválidos/i);
	});
});
