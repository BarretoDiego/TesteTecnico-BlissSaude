/**
 * @module automation/pages/BackofficeShell
 *
 * A casca autenticada: cabeçalho, menu, identidade e o modal de perfil.
 *
 * Vive fora dos page objects de tela porque está presente em todas elas — e é
 * justamente o que primeiro quebra em tela estreita, onde o menu passava por
 * cima do botão de perfil.
 */

import type { Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

/** As três telas do backoffice, na ordem do menu. */
export const SECOES = ["solicitacoes", "conferencia", "status"] as const;
export type Secao = (typeof SECOES)[number];

export class BackofficeShell extends BasePage {
	nav(secao: Secao): Locator {
		return this.byTestId(`nav-${secao}`);
	}

	get currentUser(): Locator {
		return this.byTestId("current-user");
	}

	get logout(): Locator {
		return this.byTestId("logout");
	}

	/**
	 * Navega pelo menu, e não pela URL.
	 *
	 * A diferença é o ponto do teste de navegação: ir pela URL provaria que a
	 * rota existe; ir pelo menu prova que o item está visível, alcançável e
	 * aponta para o lugar certo — que é o que quebra em tela pequena.
	 */
	async irPara(secao: Secao): Promise<void> {
		await this.nav(secao).click();
		await this.page.waitForURL(new RegExp(`/${secao}`));
	}

	/** Item ativo segundo a tela, para comparar com a rota atual. */
	async secaoAtiva(): Promise<Secao | null> {
		for (const secao of SECOES) {
			const classes = (await this.nav(secao).getAttribute("class")) ?? "";
			if (classes.includes("bg-slate-900")) return secao;
		}
		return null;
	}

	// --- perfil ----------------------------------------------------------------

	get profileDialog(): Locator {
		return this.byTestId("profile-dialog");
	}

	get profileName(): Locator {
		return this.byTestId("profile-name");
	}

	get profileEmail(): Locator {
		return this.byTestId("profile-email");
	}

	get profileRoles(): Locator {
		return this.byTestId("profile-roles");
	}

	get profileId(): Locator {
		return this.byTestId("profile-id");
	}

	get profileClose(): Locator {
		return this.byTestId("profile-dialog-close");
	}

	get profileLogout(): Locator {
		return this.byTestId("profile-dialog-logout");
	}

	async abrirPerfil(): Promise<void> {
		await this.currentUser.click();
		await this.profileDialog.waitFor({ state: "visible" });
		// O modal consulta `GET /auth/me` a cada abertura: esperar o fim da consulta
		// evita afirmar sobre a identidade do login, que é o estado transitório.
		await this.page.locator('[data-testid="profile-dialog"] [data-loading="false"]').waitFor();
	}

	/** Perfis segundo a tela, lidos do `data-*` — o texto é rótulo traduzido. */
	async perfisExibidos(): Promise<string[]> {
		const raw = (await this.profileRoles.getAttribute("data-roles")) ?? "";
		return raw ? raw.split(",") : [];
	}
}
