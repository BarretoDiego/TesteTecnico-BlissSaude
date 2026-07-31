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

	/** Autentica e espera o backoffice carregar. */
	async loginAndWait(email: string, password: string): Promise<void> {
		await this.goto();
		await this.login(email, password);
		await expect(this.byTestId("current-user")).toBeVisible();
	}

	get error() {
		return this.byTestId("login-error");
	}
}
