/**
 * @module automation/pages/LoginPage
 */

import { expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export class LoginPage extends BasePage {
	async goto(): Promise<void> {
		await this.page.goto("/login");
		await this.byTestId("login-form").waitFor();
	}

	async login(email: string, password: string): Promise<void> {
		await this.byTestId("login-email").fill(email);
		await this.byTestId("login-password").fill(password);
		await this.byTestId("login-submit").click();
	}

	/**
	 * Autentica e espera o backoffice carregar.
	 *
	 * O reenvio não é gambiarra de espera: o formulário é um componente cliente, e
	 * um clique que chega **antes da hidratação** encontra o botão pintado e sem
	 * handler — nada acontece, nenhum erro aparece, e a espera seguinte estoura
	 * com uma mensagem que não diz a causa. Foi a origem de falha intermitente na
	 * suíte inteira, já que todo teste passa por aqui.
	 *
	 * A condição de saída continua sendo o backoffice ter carregado; o que se
	 * repete é só o envio enquanto a tela ainda for a de login e nenhum erro de
	 * credencial tiver sido exibido.
	 */
	async loginAndWait(email: string, password: string): Promise<void> {
		await this.goto();
		await this.login(email, password);

		await expect(async () => {
			const naTelaDeLogin = new URL(this.page.url()).pathname.startsWith("/login");
			if (naTelaDeLogin && (await this.error.count()) === 0) {
				await this.byTestId("login-submit").click();
			}
			await expect(this.byTestId("current-user")).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 30_000 });
	}

	get error() {
		return this.byTestId("login-error");
	}
}
