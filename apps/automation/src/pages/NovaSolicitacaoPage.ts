/**
 * @module automation/pages/NovaSolicitacaoPage
 *
 * Abertura de solicitação — a tela de `POST /requests`.
 *
 * A tela valida no cliente com o **mesmo** schema Zod que a API usa, então há
 * dois desfechos de erro que só a automação distingue: o que a validação local
 * barrou (nenhuma requisição saiu) e o que a API recusou (a requisição saiu e
 * voltou com `details`). O page object expõe os dois lados.
 */

import type { Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export interface NovaSolicitacaoInput {
	title: string;
	description: string;
	priority?: "low" | "medium" | "high" | "critical";
	createdBy?: string;
}

export class NovaSolicitacaoPage extends BasePage {
	async goto(): Promise<void> {
		await this.page.goto("/solicitacoes/nova");
		await this.form.waitFor();
	}

	get form(): Locator {
		return this.byTestId("nova-solicitacao-form");
	}

	get title(): Locator {
		return this.byTestId("nova-title");
	}

	get description(): Locator {
		return this.byTestId("nova-description");
	}

	get priority(): Locator {
		return this.byTestId("nova-priority");
	}

	get createdBy(): Locator {
		return this.byTestId("nova-createdBy");
	}

	get submit(): Locator {
		return this.byTestId("nova-submit");
	}

	get cancelar(): Locator {
		return this.byTestId("nova-cancelar");
	}

	/** Erro do formulário inteiro — o que veio da API, não da validação local. */
	get formError(): Locator {
		return this.byTestId("nova-erro");
	}

	fieldError(field: "title" | "description" | "priority" | "createdBy"): Locator {
		return this.byTestId(`erro-${field}`);
	}

	/**
	 * Preenche sem enviar.
	 *
	 * Separado do envio porque parte dos testes precisa afirmar o estado do
	 * formulário preenchido — que o campo do solicitante já vem com o e-mail de
	 * quem está logado, por exemplo.
	 */
	async fill(input: NovaSolicitacaoInput): Promise<void> {
		await this.title.fill(input.title);
		await this.description.fill(input.description);
		if (input.priority) await this.priority.selectOption(input.priority);
		if (input.createdBy !== undefined) await this.createdBy.fill(input.createdBy);
	}

	async fillAndSubmit(input: NovaSolicitacaoInput): Promise<void> {
		await this.fill(input);
		await this.submit.click();
	}

	// --- confirmação -----------------------------------------------------------

	get sucesso(): Locator {
		return this.byTestId("nova-solicitacao-sucesso");
	}

	get sucessoTitulo(): Locator {
		return this.byTestId("sucesso-titulo");
	}

	get sucessoId(): Locator {
		return this.byTestId("sucesso-id");
	}

	/** `x-request-id` que o browser gerou na criação, gravado na linha do banco. */
	get sucessoTrace(): Locator {
		return this.byTestId("sucesso-trace");
	}

	get verDetalhe(): Locator {
		return this.byTestId("sucesso-ver-detalhe");
	}

	get abrirOutra(): Locator {
		return this.byTestId("sucesso-abrir-outra");
	}

	/** Id da solicitação criada, lido do `data-*` e não do texto formatado. */
	async createdId(): Promise<string> {
		await this.sucesso.waitFor();
		return (await this.sucesso.getAttribute("data-request-id")) ?? "";
	}
}
