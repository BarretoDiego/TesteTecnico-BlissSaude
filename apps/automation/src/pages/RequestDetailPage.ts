/**
 * @module automation/pages/RequestDetailPage
 */

import type { Locator } from "@playwright/test";
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

	get timelineEvents(): Locator {
		return this.byTestId("timeline-event");
	}

	get notFoundState(): Locator {
		return this.byTestId("not-found-state");
	}
}
