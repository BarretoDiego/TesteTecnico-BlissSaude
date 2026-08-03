/**
 * @module automation/pages/RequestDetailPage
 */

import type { Locator } from "@playwright/test";
import type { RequestEventType, RequestStatus } from "@saude-bliss/contracts";
import { BasePage } from "./BasePage";

export class RequestDetailPage extends BasePage {
	async goto(id: string): Promise<void> {
		await this.page.goto(`/solicitacoes/${id}`);
	}

	get container(): Locator {
		return this.byTestId("request-detail");
	}

	get title(): Locator {
		return this.byTestId("detail-title");
	}

	get createdBy(): Locator {
		return this.byTestId("detail-createdBy");
	}

	get reviewedBy(): Locator {
		return this.byTestId("detail-reviewedBy");
	}

	/** Trace da criação — o elo entre a linha do banco e as linhas de log. */
	get createdTraceId(): Locator {
		return this.byTestId("detail-createdTraceId");
	}

	get description(): Locator {
		return this.byTestId("detail-description");
	}

	get timeline(): Locator {
		return this.byTestId("detail-timeline");
	}

	get timelineEvents(): Locator {
		return this.byTestId("timeline-event");
	}

	/**
	 * Recarrega só a trilha, por `GET /reviews/{id}/timeline`.
	 *
	 * Outro microserviço: quem escreve a trilha é `bliss-reviews`, e é este botão
	 * que traz o evento de uma conferência feita noutra sessão sem recarregar a
	 * página.
	 */
	get refreshTimeline(): Locator {
		return this.byTestId("detail-refresh-timeline");
	}

	get timelineError(): Locator {
		return this.byTestId("timeline-error");
	}

	/**
	 * Evento pelo tipo, lido do `data-*` — o texto é rótulo traduzido.
	 *
	 * Rejeitar também grava um evento `reviewed`: o tipo diz que houve
	 * conferência, e o desfecho está no status para o qual ela transitou. Quem
	 * quiser distinguir os dois casos usa `eventoComDesfecho`.
	 */
	eventoDoTipo(type: RequestEventType): Locator {
		return this.page.locator(`[data-testid="timeline-event"][data-event-type="${type}"]`);
	}

	/** Evento de conferência pelo status resultante — `reviewed` ou `rejected`. */
	eventoComDesfecho(status: RequestStatus): Locator {
		return this.page.locator(
			`[data-testid="timeline-event"][data-event-type="reviewed"]:has([data-testid="badge-status"][data-status="${status}"])`
		);
	}

	get backLink(): Locator {
		return this.byTestId("back-link");
	}

	get notFoundState(): Locator {
		return this.byTestId("not-found-state");
	}
}
