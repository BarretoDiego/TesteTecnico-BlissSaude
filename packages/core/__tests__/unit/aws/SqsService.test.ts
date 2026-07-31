/**
 * Envio e consumo de mensagens.
 *
 * O foco são as decisões que separam uma fila utilizável de um `send` ingênuo:
 * enfileirar não derruba a operação já persistida, o lote respeita o limite da
 * API, e uma mensagem corrompida não trava as demais do mesmo lote.
 */

import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { resetAwsClients } from "../../../src/aws/AwsClientFactory";
import { SqsService } from "../../../src/aws/SqsService";
import { runWithRequestContext } from "../../../src/utils/requestContext";

const sqsMock = mockClient(SQSClient);
const service = new SqsService();

const FILA = "https://sqs.us-east-1.amazonaws.com/000000000000/bliss-tarefas";

/** Envelope da mensagem enviada, já desserializado. */
function corpoEnviado() {
	const { args } = sqsMock.commandCalls(SendMessageCommand)[0]!;
	return JSON.parse((args[0].input as { MessageBody: string }).MessageBody) as {
		requestId?: string;
		enqueuedAt: string;
		data: unknown;
	};
}

/** Mensagem como o SQS a devolve, já envelopada pelo serviço. */
function mensagemNaFila(data: unknown, requestId = "trace-1") {
	return {
		ReceiptHandle: "recibo-1",
		Body: JSON.stringify({ requestId, enqueuedAt: new Date().toISOString(), data }),
	};
}

/** Entrada aceita, na forma completa que o tipo do SDK exige. */
const aceita = (id: string) => ({ Id: id, MessageId: `msg-${id}`, MD5OfMessageBody: "" });

beforeEach(() => {
	sqsMock.reset();
	resetAwsClients();
});

describe("SqsService.send", () => {
	it("envia e devolve o id da mensagem", async () => {
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-1" });

		await expect(service.send(FILA, { body: { tarefa: "exportar" } })).resolves.toBe("msg-1");
	});

	it("envelopa o corpo com o requestId do contexto", async () => {
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-1" });

		await runWithRequestContext({ requestId: "trace-abc", startedAt: Date.now() }, async () => {
			await service.send(FILA, { body: { tarefa: "exportar" } });
		});

		// O consumidor loga com o mesmo id de quem enfileirou — é o que mantém o
		// trace vivo através da fronteira assíncrona.
		const corpo = corpoEnviado();
		expect(corpo.requestId).toBe("trace-abc");
		expect(corpo.data).toEqual({ tarefa: "exportar" });
	});

	it("omite atributos de FIFO e atraso quando não informados", async () => {
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-1" });

		await service.send(FILA, { body: {} });

		// Mandar `MessageGroupId` para fila padrão é erro da API, não campo ignorado.
		const { args } = sqsMock.commandCalls(SendMessageCommand)[0]!;
		expect(args[0].input).not.toHaveProperty("MessageGroupId");
		expect(args[0].input).not.toHaveProperty("DelaySeconds");
	});

	it("repassa grupo e atraso quando informados", async () => {
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-1" });

		await service.send(FILA, { body: {}, groupId: "solicitacao-1", delaySeconds: 30 });

		const { args } = sqsMock.commandCalls(SendMessageCommand)[0]!;
		expect(args[0].input).toMatchObject({ MessageGroupId: "solicitacao-1", DelaySeconds: 30 });
	});

	it("não lança quando o envio falha", async () => {
		sqsMock.on(SendMessageCommand).rejects(new Error("fila indisponível"));

		// Mesma regra do EventBridge: enfileirar é efeito colateral de algo já
		// commitado, e não pode transformar um 201 em 500.
		await expect(service.send(FILA, { body: {} })).resolves.toBeUndefined();
	});
});

describe("SqsService.sendBatch", () => {
	it("não chama a API para lista vazia", async () => {
		await expect(service.sendBatch(FILA, [])).resolves.toBe(0);
		expect(sqsMock.calls()).toHaveLength(0);
	});

	it("fatia em lotes de no máximo 10", async () => {
		sqsMock.on(SendMessageBatchCommand).callsFake((input: { Entries: unknown[] }) => ({
			Successful: input.Entries.map((_, index) => ({
				Id: String(index),
				MessageId: `msg-${index}`,
				MD5OfMessageBody: "",
			})),
		}));

		await expect(
			service.sendBatch(
				FILA,
				Array.from({ length: 25 }, (_, index) => ({ body: { index } }))
			)
		).resolves.toBe(25);

		expect(sqsMock.commandCalls(SendMessageBatchCommand)).toHaveLength(3);
	});

	it("gera ids únicos ao longo dos lotes", async () => {
		sqsMock.on(SendMessageBatchCommand).callsFake((input: { Entries: Array<{ Id: string }> }) => ({
			Successful: input.Entries.map((entry) => ({ Id: entry.Id, MessageId: `msg-${entry.Id}`, MD5OfMessageBody: "" })),
		}));

		await service.sendBatch(
			FILA,
			Array.from({ length: 12 }, (_, index) => ({ body: { index } }))
		);

		// `Id` duplicado dentro de um lote é erro; reiniciar a contagem a cada
		// fatia produziria colisão silenciosa entre lotes na leitura do resultado.
		const ids = sqsMock
			.commandCalls(SendMessageBatchCommand)
			.flatMap(({ args }) => (args[0].input as { Entries: Array<{ Id: string }> }).Entries.map((e) => e.Id));
		expect(new Set(ids).size).toBe(12);
	});

	it("repassa grupo e atraso nas entradas do lote", async () => {
		sqsMock.on(SendMessageBatchCommand).resolves({ Successful: [aceita("0")] });

		await service.sendBatch(FILA, [{ body: {}, groupId: "solicitacao-1", delaySeconds: 15 }]);

		const { args } = sqsMock.commandCalls(SendMessageBatchCommand)[0]!;
		expect((args[0].input as { Entries: unknown[] }).Entries[0]).toMatchObject({
			MessageGroupId: "solicitacao-1",
			DelaySeconds: 15,
		});
	});

	it("omite grupo e atraso nas entradas quando não informados", async () => {
		sqsMock.on(SendMessageBatchCommand).resolves({ Successful: [aceita("0")] });

		await service.sendBatch(FILA, [{ body: {} }]);

		// Mesma razão do envio unitário: `MessageGroupId` em fila padrão é erro
		// da API, não campo ignorado.
		const { args } = sqsMock.commandCalls(SendMessageBatchCommand)[0]!;
		expect((args[0].input as { Entries: unknown[] }).Entries[0]).not.toHaveProperty("MessageGroupId");
	});

	it("conta zero quando a resposta não traz aceitas", async () => {
		sqsMock.on(SendMessageBatchCommand).resolves({});

		await expect(service.sendBatch(FILA, [{ body: {} }])).resolves.toBe(0);
	});

	it("conta apenas as mensagens aceitas", async () => {
		sqsMock.on(SendMessageBatchCommand).resolves({
			Successful: [aceita("0")],
			Failed: [{ Id: "1", Code: "InternalError", SenderFault: false }],
		});

		await expect(service.sendBatch(FILA, [{ body: {} }, { body: {} }])).resolves.toBe(1);
	});

	it("segue para os lotes seguintes quando um falha", async () => {
		sqsMock
			.on(SendMessageBatchCommand)
			.rejectsOnce(new Error("falha no primeiro lote"))
			.resolves({ Successful: [aceita("0"), aceita("1")] });

		await expect(
			service.sendBatch(
				FILA,
				Array.from({ length: 12 }, () => ({ body: {} }))
			)
		).resolves.toBe(2);
	});
});

describe("SqsService.receive", () => {
	it("desembrulha o envelope e devolve o corpo original", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [mensagemNaFila({ tarefa: "exportar" }, "trace-9")] });

		const [mensagem] = await service.receive<{ tarefa: string }>(FILA);

		expect(mensagem).toMatchObject({
			receiptHandle: "recibo-1",
			body: { tarefa: "exportar" },
			requestId: "trace-9",
		});
	});

	it("devolve lista vazia quando não há mensagens", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({});

		await expect(service.receive(FILA)).resolves.toEqual([]);
	});

	it("limita o pedido ao teto da API", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

		await service.receive(FILA, 50);

		// Pedir mais de 10 é erro da API — o teto precisa ser aplicado aqui, não
		// confiado ao chamador.
		const { args } = sqsMock.commandCalls(ReceiveMessageCommand)[0]!;
		expect((args[0].input as { MaxNumberOfMessages: number }).MaxNumberOfMessages).toBe(10);
	});

	it("usa long polling por padrão", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

		await service.receive(FILA);

		// Sem isso o consumidor faz polling curto em loop, multiplicando a conta
		// de requisições sem reduzir latência.
		const { args } = sqsMock.commandCalls(ReceiveMessageCommand)[0]!;
		expect((args[0].input as { WaitTimeSeconds: number }).WaitTimeSeconds).toBe(20);
	});

	it("descarta a mensagem corrompida e entrega as demais", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({
			Messages: [
				{ ReceiptHandle: "recibo-ruim", Body: "isto não é json", MessageId: "msg-ruim" },
				mensagemNaFila({ tarefa: "ok" }),
			],
		});

		const mensagens = await service.receive<{ tarefa: string }>(FILA);

		// Uma mensagem malformada não pode travar o lote inteiro: ela expira para
		// a DLQ enquanto o resto do trabalho segue.
		expect(mensagens).toHaveLength(1);
		expect(mensagens[0]!.body).toEqual({ tarefa: "ok" });
	});

	it("ignora mensagem sem corpo ou sem recibo", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [{ MessageId: "sem-nada" }, { Body: "{}" }] });

		await expect(service.receive(FILA)).resolves.toEqual([]);
	});
});

describe("SqsService.deleteMessage", () => {
	it("remove pelo recibo", async () => {
		sqsMock.on(DeleteMessageCommand).resolves({});

		await service.deleteMessage(FILA, "recibo-1");

		// Sem o delete a mensagem reaparece após o visibility timeout e o trabalho
		// é refeito — o modo mais comum de duplicar efeito colateral.
		const { args } = sqsMock.commandCalls(DeleteMessageCommand)[0]!;
		expect(args[0].input).toMatchObject({ QueueUrl: FILA, ReceiptHandle: "recibo-1" });
	});
});
