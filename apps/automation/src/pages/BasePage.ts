/**
 * @module automation/pages/BasePage
 */

import type { Locator, Page } from "@playwright/test";

/** Base dos page objects: navegação e localizadores comuns. */
export abstract class BasePage {
	/**
	 * Público, e não protegido, de propósito.
	 *
	 * Page object cobre o que é do domínio da tela; o resto — recarregar,
	 * inspecionar console, esperar navegação — é do Playwright, e envolvê-lo em
	 * método só para manter o `page` escondido produziria uma camada de repasse
	 * sem valor. O teste alcança o `page` quando precisa e usa o page object para
	 * tudo que tem significado de negócio.
	 */
	constructor(readonly page: Page) {}

	protected byTestId(testId: string): Locator {
		return this.page.getByTestId(testId);
	}

	/** Mensagem de erro exibida na tela, se houver. */
	get errorState(): Locator {
		return this.byTestId("error-state");
	}

	/** `requestId` da última resposta, para correlacionar com os logs. */
	get requestIdBadge(): Locator {
		return this.byTestId("request-id-badge");
	}

	async currentRequestId(): Promise<string | null> {
		const badge = this.requestIdBadge;
		if ((await badge.count()) === 0) return null;
		return badge.getAttribute("data-request-id");
	}

	/**
	 * Espera a tela sair do estado de carregamento.
	 *
	 * Explícito em vez de `waitForTimeout`: espera fixa ou é lenta demais ou é
	 * curta demais, e é a origem mais comum de suíte instável.
	 */
	async waitForLoaded(): Promise<void> {
		await this.byTestId("loading-state")
			.waitFor({ state: "detached" })
			.catch(() => undefined);
	}
}
