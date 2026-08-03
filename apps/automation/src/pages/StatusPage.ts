/**
 * @module automation/pages/StatusPage
 *
 * Estado da malha de microserviços.
 *
 * É a única tela que exercita os três `/health` e o `GET /auth/me` — as rotas
 * que nenhum outro fluxo toca. Verificá-la aqui é o que fecha a cobertura das
 * rotas publicadas pela API.
 */

import type { Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

/** Os serviços sondados. Mesmos nomes que a API devolve em `service`. */
export const SERVICOS = ["bliss-auth", "bliss-requests", "bliss-reviews"] as const;
export type Servico = (typeof SERVICOS)[number];

export class StatusPage extends BasePage {
	async goto(): Promise<void> {
		await this.page.goto("/status");
		await this.container.waitFor();
		await this.waitForCheck();
	}

	get container(): Locator {
		return this.byTestId("status-page");
	}

	/** A tabela de sondas, que é o container rolável em tela estreita. */
	get table(): Locator {
		return this.byTestId("status-table");
	}

	get recheck(): Locator {
		return this.byTestId("status-recheck");
	}

	row(service: Servico): Locator {
		return this.byTestId(`status-row-${service}`);
	}

	badge(service: Servico): Locator {
		return this.byTestId(`status-badge-${service}`);
	}

	get identidade(): Locator {
		return this.byTestId("status-identidade");
	}

	get identidadeNome(): Locator {
		return this.byTestId("identidade-nome");
	}

	get identidadeEmail(): Locator {
		return this.byTestId("identidade-email");
	}

	get identidadePerfis(): Locator {
		return this.byTestId("identidade-perfis");
	}

	/**
	 * Espera a rodada de sondagem terminar.
	 *
	 * `data-loading` é o sinal correto: as sondas correm em paralelo e a tabela
	 * fica com as linhas da rodada anterior enquanto a nova responde — ler antes
	 * disso afirmaria sobre o resultado velho.
	 */
	async waitForCheck(): Promise<void> {
		await this.page.locator('[data-testid="status-page"][data-loading="false"]').waitFor();
	}

	/** `true` quando todas as sondas responderam `ok`. */
	async allUp(): Promise<boolean> {
		return (await this.container.getAttribute("data-all-up")) === "true";
	}
}
