/**
 * @module automation/pages/RequestsListPage
 */

import type { Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export interface RowSnapshot {
	id: string;
	title: string;
	createdBy: string;
	status: string;
	priority: string;
}

export class RequestsListPage extends BasePage {
	/**
	 * Navega já filtrado.
	 *
	 * Os filtros vivem na URL, então dá para chegar ao estado desejado sem
	 * simular cliques — menos passos, menos pontos de instabilidade.
	 */
	async goto(filters: Record<string, string> = {}): Promise<void> {
		const query = new URLSearchParams(filters).toString();
		await this.page.goto(`/solicitacoes${query ? `?${query}` : ""}`);

		/**
		 * Espera os dados **desta** consulta.
		 *
		 * Esperar só o fim do carregamento não basta: ao navegar entre filtros a
		 * tabela anterior segue na tela, e a leitura pegaria o resultado antigo.
		 * Foi exatamente essa corrida que fazia um teste diferente falhar a cada
		 * execução. O seletor casa com `data-query`, que a tela só preenche depois
		 * de renderizar o resultado correspondente.
		 */
		await this.page.locator(`[data-testid="requests-list"][data-query="${query}"]`).waitFor();
	}

	/**
	 * Espera os dados de uma consulta específica terem sido renderizados.
	 *
	 * Extraído de `goto` porque uma recarga precisa da mesma espera: sem ela, a
	 * leitura acontece enquanto a tela ainda mostra o resultado anterior.
	 */
	async waitForQuery(filters: Record<string, string> = {}): Promise<void> {
		const query = new URLSearchParams(filters).toString();
		await this.page.locator(`[data-testid="requests-list"][data-query="${query}"]`).waitFor();
	}

	get rows(): Locator {
		return this.page.locator('[data-testid^="request-row-"]');
	}

	get emptyState(): Locator {
		return this.byTestId("empty-state");
	}

	get total(): Locator {
		return this.byTestId("requests-total");
	}

	rowById(id: string): Locator {
		return this.byTestId(`request-row-${id}`);
	}

	/**
	 * Extrai o que a tela mostra, para comparar com a API.
	 *
	 * Lê de `data-*` e não do texto: o texto é traduzido e formatado, e comparar
	 * "Aberta" com `open` exigiria manter a tabela de tradução em dois lugares.
	 */
	async snapshotRows(): Promise<RowSnapshot[]> {
		return this.rows.evaluateAll((elements) =>
			elements.map((row) => ({
				id: row.getAttribute("data-request-id") ?? "",
				title: row.querySelector('[data-testid="request-cell-title"]')?.textContent?.trim() ?? "",
				createdBy: row.querySelector('[data-testid="request-cell-createdBy"]')?.textContent?.trim() ?? "",
				status: row.querySelector('[data-testid="badge-status"]')?.getAttribute("data-status") ?? "",
				priority: row.querySelector('[data-testid="badge-priority"]')?.getAttribute("data-priority") ?? "",
			}))
		);
	}

	async openRequest(id: string): Promise<void> {
		await this.rowById(id).locator('[data-testid="request-cell-title"]').click();
	}
}
