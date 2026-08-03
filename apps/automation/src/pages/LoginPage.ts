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

		// A janela de 6s antes de reenviar não é chute: um envio que pegou já saiu
		// da tela de login bem antes disso. Reenviar mais cedo cairia em cima de uma
		// autenticação em andamento — trocando uma corrida por outra.
		for (let tentativa = 0; tentativa < 3; tentativa += 1) {
			const saiuDoLogin = await this.page
				.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 6_000 })
				.then(() => true)
				.catch(() => false);

			if (saiuDoLogin) break;

			// Credencial recusada é resposta, não clique perdido: reenviar só
			// repetiria a recusa e esconderia a causa real da falha. Falha de
			// comunicação é o oposto — a requisição não chegou, e reenviar é
			// exatamente o que uma pessoa faria.
			if (await this.credencialRecusada()) break;

			await this.byTestId("login-submit").click();
		}

		await expect(this.byTestId("current-user")).toBeVisible();
	}

	get error() {
		return this.byTestId("login-error");
	}

	/**
	 * Distingue a recusa da credencial de qualquer outra falha exibida no mesmo
	 * lugar.
	 *
	 * A tela usa um único elemento de erro para os dois casos, e eles pedem
	 * tratamentos opostos: a recusa é a resposta do servidor — reenviar só a
	 * repetiria —, enquanto uma falha de transporte significa que a requisição não
	 * chegou. A mensagem de credencial é deliberadamente a mesma para e-mail
	 * inexistente e senha errada, então casar por "inválidos" cobre os dois sem
	 * depender de qual campo errou.
	 */
	private async credencialRecusada(): Promise<boolean> {
		if ((await this.error.count()) === 0) return false;
		return /inválid/i.test((await this.error.innerText()) ?? "");
	}
}
