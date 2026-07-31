/**
 * @module core/aws/EventBridgeService
 *
 * Publicação de eventos de domínio no EventBridge.
 *
 * É o canal de comunicação **entre microserviços** no padrão da casa. A regra que
 * ele preserva: um serviço nunca chama o outro por HTTP para avisar que algo
 * aconteceu — publica o fato e segue. Sem isso, `bliss-requests` precisaria
 * conhecer a URL de `bliss-reviews`, e a fronteira de domínio viraria só uma
 * convenção de pastas.
 *
 * O `requestId` viaja no envelope do evento, então um trace que começou no
 * browser sobrevive ao salto assíncrono — que é justamente onde correlação
 * costuma se perder.
 */

import { EventBridgeClient, PutEventsCommand, type PutEventsRequestEntry } from "@aws-sdk/client-eventbridge";
import { BaseService } from "../common/BaseService";
import { envService } from "../config/EnvService";
import { getRequestId } from "../utils/requestContext";
import { getAwsClient } from "./AwsClientFactory";

const MODULE = "EventBridgeService";

/** Limite da API: `PutEvents` aceita no máximo 10 entradas por chamada. */
const MAX_ENTRIES_PER_CALL = 10;

export interface DomainEvent<TDetail = unknown> {
	/** Tipo do evento, ex.: `RequestCreated`. */
	type: string;
	/** Serviço que publicou, ex.: `bliss-requests`. Vira o `Source` do evento. */
	source: string;
	detail: TDetail;
}

export class EventBridgeService extends BaseService {
	private get client(): EventBridgeClient {
		return getAwsClient("eventbridge", (config) => new EventBridgeClient(config));
	}

	private get busName(): string {
		return envService.optional("EVENT_BUS_NAME", `saude-bliss-${envService.getEnv()}`);
	}

	private toEntry(event: DomainEvent): PutEventsRequestEntry {
		return {
			EventBusName: this.busName,
			Source: `saude-bliss.${event.source}`,
			DetailType: event.type,
			Detail: JSON.stringify({
				// O trace atravessa a fronteira assíncrona — o consumidor loga com o
				// mesmo requestId de quem publicou.
				requestId: getRequestId(),
				publishedAt: new Date().toISOString(),
				data: event.detail,
			}),
		};
	}

	/**
	 * Publica um evento.
	 *
	 * Não lança: falha de publicação **não** pode derrubar a operação de negócio
	 * que já foi persistida. Um evento perdido é recuperável por reprocessamento;
	 * um 500 devolvido depois do commit não é. A falha vira log de erro, que é o
	 * gancho do alarme.
	 */
	async publish(event: DomainEvent): Promise<boolean> {
		return (await this.publishBatch([event])) === 1;
	}

	/**
	 * Publica vários eventos, fatiando conforme o limite da API.
	 *
	 * @returns quantos eventos foram aceitos.
	 */
	async publishBatch(events: readonly DomainEvent[]): Promise<number> {
		if (events.length === 0) return 0;

		this.logStart(MODULE, "publishBatch", "publicando eventos", {
			count: events.length,
			types: events.map((event) => event.type),
		});

		let accepted = 0;

		for (let index = 0; index < events.length; index += MAX_ENTRIES_PER_CALL) {
			const slice = events.slice(index, index + MAX_ENTRIES_PER_CALL);

			try {
				const response = await this.client.send(new PutEventsCommand({ Entries: slice.map((e) => this.toEntry(e)) }));
				accepted += slice.length - (response.FailedEntryCount ?? 0);

				// `PutEvents` responde 200 mesmo com entradas rejeitadas — ignorar
				// `FailedEntryCount` é o modo clássico de perder evento em silêncio.
				if (response.FailedEntryCount) {
					this.logError(MODULE, "publishBatch", "entradas rejeitadas pelo EventBridge", {
						failed: response.FailedEntryCount,
						reasons: response.Entries?.filter((entry) => entry.ErrorCode).map((entry) => entry.ErrorCode),
					});
				}
			} catch (error) {
				this.logError(MODULE, "publishBatch", "falha ao publicar eventos", { error, count: slice.length });
			}
		}

		this.logSuccess(MODULE, "publishBatch", "publicação concluída", { accepted, total: events.length });
		return accepted;
	}
}

export const eventBridgeService = new EventBridgeService();
