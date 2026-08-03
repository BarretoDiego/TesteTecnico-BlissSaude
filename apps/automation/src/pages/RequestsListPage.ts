/**
 * @module automation/pages/RequestsListPage
 */

import { expect, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export interface RowSnapshot {
	id: string;
	title: string;
	createdBy: string;
	status: string;
	priority: string;
}

/** O estado da paginação como a tela o publica. */
export interface PaginationState {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
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

	// --- filtros pela tela -----------------------------------------------------
	//
	// Navegar pela URL é o caminho curto e é o que a maior parte dos testes usa.
	// Estes métodos existem para o caso oposto: provar que os controles da tela
	// **produzem** aquela URL. Sem isso, um filtro que parou de escrever no
	// endereço passaria despercebido, porque todo teste chegaria pronto ao estado
	// que ele deveria criar.

	get filters(): Locator {
		return this.byTestId("requests-filters");
	}

	get filterStatus(): Locator {
		return this.byTestId("filter-status");
	}

	get filterPriority(): Locator {
		return this.byTestId("filter-priority");
	}

	get filterCreatedBy(): Locator {
		return this.byTestId("filter-createdBy");
	}

	get filterClear(): Locator {
		return this.byTestId("filter-clear");
	}

	async selecionarStatus(status: string): Promise<void> {
		await this.aoMudarConsulta(() => this.filterStatus.selectOption(status));
	}

	async selecionarPrioridade(priority: string): Promise<void> {
		await this.aoMudarConsulta(() => this.filterPriority.selectOption(priority));
	}

	/**
	 * Digita o solicitante e tira o foco.
	 *
	 * O `blur` não é detalhe de implementação vazando para o teste: a tela filtra
	 * no `onBlur` de propósito, para não disparar uma requisição por tecla
	 * digitada. Sem o `blur` explícito o filtro simplesmente não acontece.
	 */
	async digitarSolicitante(createdBy: string): Promise<void> {
		await this.filterCreatedBy.fill(createdBy);
		await this.aoMudarConsulta(() => this.filterCreatedBy.blur());
	}

	async limparFiltros(): Promise<void> {
		await this.aoMudarConsulta(() => this.filterClear.click());
	}

	// --- paginação -------------------------------------------------------------

	get pagination(): Locator {
		return this.byTestId("pagination");
	}

	get paginationSummary(): Locator {
		return this.byTestId("pagination-summary");
	}

	get pageSizeSelect(): Locator {
		return this.byTestId("pagination-page-size");
	}

	get nextPage(): Locator {
		return this.byTestId("pagination-next");
	}

	get previousPage(): Locator {
		return this.byTestId("pagination-prev");
	}

	pageButton(page: number): Locator {
		return this.byTestId(`pagination-page-${page}`);
	}

	/** Paginação segundo a tela — dos `data-*`, não do texto do resumo. */
	async paginationState(): Promise<PaginationState> {
		const element = this.pagination;
		const [page, pageSize, total, totalPages] = await Promise.all([
			element.getAttribute("data-page"),
			element.getAttribute("data-page-size"),
			element.getAttribute("data-total"),
			element.getAttribute("data-total-pages"),
		]);

		return {
			page: Number(page ?? 0),
			pageSize: Number(pageSize ?? 0),
			total: Number(total ?? 0),
			totalPages: Number(totalPages ?? 0),
		};
	}

	async irParaProximaPagina(): Promise<void> {
		await this.aoMudarConsulta(() => this.nextPage.click());
	}

	async irParaPaginaAnterior(): Promise<void> {
		await this.aoMudarConsulta(() => this.previousPage.click());
	}

	async irParaPagina(page: number): Promise<void> {
		await this.aoMudarConsulta(() => this.pageButton(page).click());
	}

	async escolherTamanhoDePagina(size: number): Promise<void> {
		await this.aoMudarConsulta(() => this.pageSizeSelect.selectOption(String(size)));
	}

	/**
	 * Executa a ação e espera a tela alcançar a **nova** consulta.
	 *
	 * A ordem das duas esperas é o ponto. Esperar só o `data-query` bater com a
	 * URL não funciona: no instante seguinte ao clique nem o endereço mudou nem a
	 * tela redesenhou, então os dois ainda batem — pela consulta antiga — e a
	 * leitura sai com os dados da página anterior. Foi assim que a paginação
	 * "passou" mostrando a mesma solicitação nas duas páginas.
	 *
	 * A espera pelo endereço é uma **sondagem**, e não `waitForURL`. Filtrar e
	 * paginar mudam só a query string da mesma rota: o App Router resolve isso com
	 * `history.replaceState` e um redesenho, sem evento de navegação e sem novo
	 * `load`. `waitForURL` espera por navegação e fica pendurado até o teste
	 * estourar — o que acontecia no CI, contra o build de produção, enquanto
	 * passava no servidor de desenvolvimento.
	 */
	private async aoMudarConsulta(acao: () => Promise<unknown>): Promise<void> {
		const antes = this.page.url();
		await acao();

		await expect
			.poll(() => this.page.url(), { message: "o controle deveria ter escrito a nova consulta no endereço" })
			.not.toBe(antes);

		await this.waitForCurrentQuery();
	}

	/**
	 * Espera a tela ter renderizado os dados da consulta que está na barra de
	 * endereço **agora**.
	 *
	 * `waitForQuery` serve quando o teste sabe de antemão qual é a consulta. Aqui
	 * ele não sabe: quem montou a URL foi o controle da tela, e a ordem dos
	 * parâmetros depende da ordem em que foram acrescentados. Comparar com a URL
	 * corrente cobre os dois passos — o endereço mudou e os dados o alcançaram.
	 */
	async waitForCurrentQuery(): Promise<void> {
		await expect
			.poll(
				async () => {
					const esperado = new URL(this.page.url()).searchParams.toString();
					const renderizado = await this.byTestId("requests-list").getAttribute("data-query");
					return renderizado === esperado;
				},
				{ message: "a tela deveria renderizar os dados da consulta que está na URL" }
			)
			.toBe(true);
	}

	/** Parâmetros da URL atual, para afirmar que o controle escreveu no endereço. */
	searchParams(): URLSearchParams {
		return new URL(this.page.url()).searchParams;
	}
}
