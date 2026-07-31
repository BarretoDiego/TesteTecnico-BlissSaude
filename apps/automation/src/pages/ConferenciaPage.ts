/**
 * @module automation/pages/ConferenciaPage
 */

import { expect, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage";
import { RequestsListPage, type RowSnapshot } from "./RequestsListPage";

export class ConferenciaPage extends BasePage {
	async goto(): Promise<void> {
		await this.page.goto("/conferencia");
		// `data-loading="false"` é o sinal de que a fila terminou de carregar —
		// esperar o container só provaria que a página montou.
		await this.page.locator('[data-testid="conferencia"][data-loading="false"]').waitFor();
		await this.byTestId("conferencia-queue").waitFor();
	}

	get queue(): Locator {
		return this.byTestId("conferencia-queue");
	}

	get pendingCount(): Locator {
		return this.byTestId("conferencia-pending-count");
	}

	get rows(): Locator {
		return this.page.locator('[data-testid^="request-row-"]');
	}

	rowById(id: string): Locator {
		return this.byTestId(`request-row-${id}`);
	}

	/** Reaproveita a extração da listagem: a tabela é o mesmo componente. */
	async snapshotRows(): Promise<RowSnapshot[]> {
		return new RequestsListPage(this.page).snapshotRows();
	}

	/**
	 * Registra a conferência de uma solicitação.
	 *
	 * Três esperas, cada uma cobrindo uma falha real observada:
	 *
	 * 1. A **linha** precisa estar visível. Sem isso o clique pode cair enquanto a
	 *    fila ainda renderiza, e o Playwright resolve o localizador para nada.
	 * 2. O **botão** precisa estar habilitado. Ele fica desabilitado durante uma
	 *    conferência em andamento, e clicar num botão desabilitado não faz nada —
	 *    silenciosamente. O teste só descobre no timeout da espera seguinte, com
	 *    uma mensagem que não indica a causa.
	 * 3. A linha sai da fila quando a API confirma. É o sinal correto de conclusão,
	 *    e não um tempo fixo.
	 */
	private async mark(id: string, action: "reviewed" | "rejected"): Promise<void> {
		await this.rowById(id).waitFor({ state: "visible" });

		const button = this.byTestId(`conferencia-mark-${action}-${id}`);
		await button.waitFor({ state: "visible" });
		await expect(button).toBeEnabled();
		await button.click();

		await this.rowById(id).waitFor({ state: "detached" });
	}

	async markAsReviewed(id: string): Promise<void> {
		await this.mark(id, "reviewed");
	}

	async markAsRejected(id: string): Promise<void> {
		await this.mark(id, "rejected");
	}
}
