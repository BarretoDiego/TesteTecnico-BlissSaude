/**
 * @module core/aws/SqsService
 *
 * Envio e consumo de mensagens no SQS.
 *
 * Usado para trabalho que não pode acontecer no ciclo da requisição — envio de
 * notificação, exportação de relatório, reprocessamento. Diferente do
 * EventBridge, que anuncia um fato para quem quiser ouvir, a fila endereça uma
 * tarefa a um consumidor específico.
 */

import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { BaseService } from "../common/BaseService";
import { getRequestId } from "../utils/requestContext";
import { getAwsClient } from "./AwsClientFactory";

const MODULE = "SqsService";

/** Limite da API: `SendMessageBatch` aceita no máximo 10 mensagens. */
const MAX_BATCH_SIZE = 10;

export interface SqsMessage<TBody = unknown> {
	body: TBody;
	/**
	 * Chave de deduplicação/ordenação em filas FIFO. Em fila padrão é ignorada —
	 * passar mesmo assim mantém o chamador agnóstico ao tipo da fila.
	 */
	groupId?: string;
	/** Atraso de entrega em segundos (0–900). */
	delaySeconds?: number;
}

export interface ReceivedMessage<TBody = unknown> {
	receiptHandle: string;
	body: TBody;
	requestId?: string;
	receivedAt: string;
}

export class SqsService extends BaseService {
	private get client(): SQSClient {
		return getAwsClient("sqs", (config) => new SQSClient(config));
	}

	/** Envelopa o corpo com o trace, para o consumidor logar com o mesmo id. */
	private envelope(body: unknown): string {
		return JSON.stringify({ requestId: getRequestId(), enqueuedAt: new Date().toISOString(), data: body });
	}

	async send(queueUrl: string, message: SqsMessage): Promise<string | undefined> {
		this.logStart(MODULE, "send", "enviando mensagem", { queueUrl });

		try {
			const response = await this.client.send(
				new SendMessageCommand({
					QueueUrl: queueUrl,
					MessageBody: this.envelope(message.body),
					...(message.groupId ? { MessageGroupId: message.groupId } : {}),
					...(message.delaySeconds ? { DelaySeconds: message.delaySeconds } : {}),
				})
			);

			this.logSuccess(MODULE, "send", "mensagem enviada", { messageId: response.MessageId });
			return response.MessageId;
		} catch (error) {
			// Como no EventBridge: enfileirar é efeito colateral e não pode derrubar
			// a operação de negócio já persistida.
			this.logError(MODULE, "send", "falha ao enviar mensagem", { error, queueUrl });
			return undefined;
		}
	}

	/** Envia em lote, fatiando conforme o limite da API. @returns quantas foram aceitas. */
	async sendBatch(queueUrl: string, messages: readonly SqsMessage[]): Promise<number> {
		if (messages.length === 0) return 0;

		let accepted = 0;

		for (let index = 0; index < messages.length; index += MAX_BATCH_SIZE) {
			const slice = messages.slice(index, index + MAX_BATCH_SIZE);

			try {
				const response = await this.client.send(
					new SendMessageBatchCommand({
						QueueUrl: queueUrl,
						Entries: slice.map((message, position) => ({
							Id: `${index + position}`,
							MessageBody: this.envelope(message.body),
							...(message.groupId ? { MessageGroupId: message.groupId } : {}),
							...(message.delaySeconds ? { DelaySeconds: message.delaySeconds } : {}),
						})),
					})
				);

				accepted += response.Successful?.length ?? 0;

				if (response.Failed?.length) {
					this.logError(MODULE, "sendBatch", "mensagens rejeitadas pelo SQS", {
						failed: response.Failed.length,
						reasons: response.Failed.map((entry) => entry.Code),
					});
				}
			} catch (error) {
				this.logError(MODULE, "sendBatch", "falha ao enviar lote", { error, count: slice.length });
			}
		}

		this.logSuccess(MODULE, "sendBatch", "envio concluído", { accepted, total: messages.length });
		return accepted;
	}

	/**
	 * Consome mensagens.
	 *
	 * `waitTimeSeconds` alto ativa long polling — sem ele o consumidor faz
	 * polling curto em loop, o que multiplica a conta de requisições do SQS sem
	 * reduzir latência.
	 */
	async receive<TBody>(queueUrl: string, max = 10, waitTimeSeconds = 20): Promise<ReceivedMessage<TBody>[]> {
		const response = await this.client.send(
			new ReceiveMessageCommand({
				QueueUrl: queueUrl,
				MaxNumberOfMessages: Math.min(max, MAX_BATCH_SIZE),
				WaitTimeSeconds: waitTimeSeconds,
			})
		);

		return (response.Messages ?? []).flatMap((message) => {
			if (!message.Body || !message.ReceiptHandle) return [];

			try {
				const parsed = JSON.parse(message.Body) as { requestId?: string; enqueuedAt: string; data: TBody };
				return [
					{
						receiptHandle: message.ReceiptHandle,
						body: parsed.data,
						requestId: parsed.requestId,
						receivedAt: new Date().toISOString(),
					},
				];
			} catch (error) {
				// Mensagem malformada não deve travar o lote inteiro: registra e segue,
				// deixando-a expirar para a DLQ.
				this.logError(MODULE, "receive", "mensagem com corpo inválido", { error, messageId: message.MessageId });
				return [];
			}
		});
	}

	/** Remove a mensagem da fila. Sem isso ela reaparece após o visibility timeout. */
	async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
		await this.client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
	}
}

export const sqsService = new SqsService();
