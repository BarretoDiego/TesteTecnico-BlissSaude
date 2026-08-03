/**
 * @module automation/pages/ConferenciaPage
 */

import { expect, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage";
import { RequestsListPage, type RowSnapshot } from "./RequestsListPage";

export class ConferenciaPage extends BasePage {
	async goto(query: { page?: number; pageSize?: number } = {}): Promise<void> {
		const params = new URLSearchParams();
		if (query.page) params.set("page", String(query.page));
		if (query.pageSize) params.set("pageSize", String(query.pageSize));
		const search = params.toString();

		await this.page.goto(search ? `/conferencia?${search}` : "/conferencia");

		// `data-query` e não só `data-loading`: numa navegação entre páginas a
		// tabela anterior continua na tela enquanto a nova consulta corre, e
		// esperar só pela ausência de carregamento leria os dados da página velha.
		await this.page.locator(`[data-testid="conferencia"][data-query="${search}"]`).waitFor();
		await this.byTestId("conferencia-queue").waitFor();
	}

	get queue(): Locator {
		return this.byTestId("conferencia-queue");
	}

	/**
	 * Executa a ação e espera a fila alcançar a **nova** consulta.
	 *
	 * As duas esperas cobrem armadilhas distintas, e nenhuma sozinha basta.
	 * Esperar `data-loading="false"` não serve: o atributo já é `false` antes do
	 * toque, então a espera passa na hora e a leitura sai com a página anterior —
	 * foi assim que a paginação da fila leu zero linha no CI. E comparar
	 * `data-query` com a URL precisa vir **depois** de o endereço mudar: no
	 * instante do toque os dois ainda batem, pela consulta antiga.
	 */
	async mudarConsulta(acao: () => Promise<unknown>): Promise<void> {
		const antes = this.page.url();
		await acao();

		await expect
			.poll(() => this.page.url(), { message: "a paginação deveria ter escrito a nova consulta no endereço" })
			.not.toBe(antes);

		await expect
			.poll(
				async () => {
					const esperado = new URL(this.page.url()).searchParams.toString();
					return (await this.byTestId("conferencia").getAttribute("data-query")) === esperado;
				},
				{ message: "a fila deveria renderizar os dados da consulta que está na URL" }
			)
			.toBe(true);
	}

	get pendingCount(): Locator {
		return this.byTestId("conferencia-pending-count");
	}

	/**
	 * Total de pendentes segundo o banco, não o número de linhas na tela.
	 *
	 * A distinção passou a importar quando a fila virou paginada: conferir uma
	 * solicitação tira a linha e a recarga puxa a próxima pendente para o lugar,
	 * então a contagem de linhas fica igual — só o total cai.
	 */
	async pendingTotal(): Promise<number> {
		const value = await this.byTestId("pagination").getAttribute("data-total");
		return Number(value ?? 0);
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

	get confirmDialog(): Locator {
		return this.byTestId("confirm-dialog");
	}

	/**
	 * Registra a conferência de uma solicitação.
	 *
	 * Cada espera cobre uma falha real observada:
	 *
	 * 1. A **linha** precisa estar visível. Sem isso o clique pode cair enquanto a
	 *    fila ainda renderiza, e o Playwright resolve o localizador para nada.
	 * 2. O **botão** precisa estar habilitado. Ele fica desabilitado durante uma
	 *    conferência em andamento, e clicar num botão desabilitado não faz nada —
	 *    silenciosamente. O teste só descobre no timeout da espera seguinte, com
	 *    uma mensagem que não indica a causa.
	 * 3. O **modal** precisa estar aberto antes do segundo clique: o `<dialog>`
	 *    nativo sobe para a camada de topo, e confirmar antes disso erra o alvo.
	 * 4. A linha sai da fila quando a API confirma. É o sinal correto de conclusão,
	 *    e não um tempo fixo.
	 */
	private async mark(id: string, action: "reviewed" | "rejected"): Promise<void> {
		await this.rowById(id).waitFor({ state: "visible" });

		const button = this.byTestId(`conferencia-mark-${action}-${id}`);
		await button.waitFor({ state: "visible" });
		await expect(button).toBeEnabled();
		await button.click();

		// Conferir passou a exigir confirmação: a ação é irreversível e fica
		// registrada em nome de quem confirmou.
		await this.confirmDialog.waitFor({ state: "visible" });
		await this.byTestId("confirm-dialog-confirm").click();

		await this.rowById(id).waitFor({ state: "detached" });
	}

	/** Abre a confirmação e desiste — para afirmar que nada foi registrado. */
	async openConfirmationAndCancel(id: string, action: "reviewed" | "rejected"): Promise<void> {
		await this.rowById(id).waitFor({ state: "visible" });
		await this.byTestId(`conferencia-mark-${action}-${id}`).click();
		await this.confirmDialog.waitFor({ state: "visible" });
		await this.byTestId("confirm-dialog-cancel").click();
		await this.confirmDialog.waitFor({ state: "hidden" });
	}

	async markAsReviewed(id: string): Promise<void> {
		await this.mark(id, "reviewed");
	}

	async markAsRejected(id: string): Promise<void> {
		await this.mark(id, "rejected");
	}
}
