/**
 * Publicação de eventos de domínio.
 *
 * Duas propriedades sustentam o desenho e são o foco aqui: publicar **nunca**
 * derruba a operação de negócio já persistida, e o `requestId` sobrevive ao
 * salto assíncrono — que é justamente onde correlação costuma se perder.
 */

import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { mockClient } from "aws-sdk-client-mock";
import { resetAwsClients } from "../../../src/aws/AwsClientFactory";
import { EventBridgeService } from "../../../src/aws/EventBridgeService";
import { runWithRequestContext } from "../../../src/utils/requestContext";

const eventBridgeMock = mockClient(EventBridgeClient);
const service = new EventBridgeService();

const evento = (type = "RequestCreated") => ({ type, source: "bliss-requests", detail: { id: "abc" } });

/** Corpo do primeiro `Entries` enviado, já desserializado. */
function primeiroDetail() {
	const { args } = eventBridgeMock.commandCalls(PutEventsCommand)[0]!;
	const entries = (args[0].input as { Entries: Array<{ Detail: string }> }).Entries;
	return JSON.parse(entries[0]!.Detail) as { requestId: string | undefined; publishedAt: string; data: unknown };
}

beforeEach(() => {
	eventBridgeMock.reset();
	resetAwsClients();
	eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
});

describe("EventBridgeService.publish", () => {
	it("publica e confirma o aceite", async () => {
		await expect(service.publish(evento())).resolves.toBe(true);
		expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
	});

	it("prefixa a origem com o namespace do projeto", async () => {
		await service.publish(evento());

		const { args } = eventBridgeMock.commandCalls(PutEventsCommand)[0]!;
		const entries = (args[0].input as { Entries: Array<{ Source: string; DetailType: string }> }).Entries;

		// Sem o prefixo, uma regra do EventBridge que case por `Source` pegaria
		// eventos de qualquer outra aplicação da mesma conta.
		expect(entries[0]!.Source).toBe("saude-bliss.bliss-requests");
		expect(entries[0]!.DetailType).toBe("RequestCreated");
	});

	it("carrega o requestId do contexto para dentro do evento", async () => {
		await runWithRequestContext({ requestId: "trace-123", startedAt: Date.now() }, async () => {
			await service.publish(evento());
		});

		// É o elo que faz o consumidor logar com o mesmo id de quem publicou.
		expect(primeiroDetail().requestId).toBe("trace-123");
	});

	it("publica mesmo sem contexto de requisição", async () => {
		await service.publish(evento());

		// Publicação disparada por cron ou por consumidor de fila não tem
		// requisição HTTP na origem — não pode falhar por isso.
		expect(primeiroDetail().requestId).toBeUndefined();
	});

	it("devolve false quando o EventBridge rejeita a entrada", async () => {
		eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 1, Entries: [{ ErrorCode: "InternalFailure" }] });

		await expect(service.publish(evento())).resolves.toBe(false);
	});

	it("não lança quando a chamada falha", async () => {
		eventBridgeMock.on(PutEventsCommand).rejects(new Error("rede indisponível"));

		// A regra central: o evento é efeito colateral de algo já commitado. Um
		// 500 depois do commit não é recuperável; evento perdido é.
		await expect(service.publish(evento())).resolves.toBe(false);
	});
});

describe("EventBridgeService.publishBatch", () => {
	it("não chama a API para lista vazia", async () => {
		await expect(service.publishBatch([])).resolves.toBe(0);
		expect(eventBridgeMock.calls()).toHaveLength(0);
	});

	it("fatia em chamadas de no máximo 10 entradas", async () => {
		const eventos = Array.from({ length: 23 }, (_, index) => evento(`Evento${index}`));

		await expect(service.publishBatch(eventos)).resolves.toBe(23);

		// `PutEvents` recusa lotes maiores que 10 — sem o fatiamento, 23 eventos
		// viram uma chamada rejeitada inteira.
		const chamadas = eventBridgeMock.commandCalls(PutEventsCommand);
		expect(chamadas).toHaveLength(3);
		expect((chamadas[0]!.args[0].input as { Entries: unknown[] }).Entries).toHaveLength(10);
		expect((chamadas[2]!.args[0].input as { Entries: unknown[] }).Entries).toHaveLength(3);
	});

	it("desconta as entradas rejeitadas da contagem de aceitas", async () => {
		eventBridgeMock
			.on(PutEventsCommand)
			.resolves({ FailedEntryCount: 2, Entries: [{ ErrorCode: "ThrottlingException" }] });

		// `PutEvents` responde 200 mesmo com entradas rejeitadas: ignorar
		// `FailedEntryCount` é o modo clássico de perder evento em silêncio.
		await expect(service.publishBatch([evento(), evento(), evento()])).resolves.toBe(1);
	});

	it("registra a rejeição mesmo sem detalhe das entradas", async () => {
		// A API pode responder `FailedEntryCount` sem `Entries`. Sem o encadeamento
		// opcional o log de erro estouraria — e a falha de publicação viraria uma
		// exceção justamente no caminho que existe para nunca lançar.
		eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 1 });

		await expect(service.publishBatch([evento()])).resolves.toBe(0);
	});

	it("segue para os lotes seguintes quando um falha", async () => {
		const eventos = Array.from({ length: 15 }, () => evento());
		eventBridgeMock
			.on(PutEventsCommand)
			.rejectsOnce(new Error("falha no primeiro lote"))
			.resolves({ FailedEntryCount: 0 });

		// Um lote com problema não deve descartar os demais — o segundo ainda
		// entrega suas 5 entradas.
		await expect(service.publishBatch(eventos)).resolves.toBe(5);
		expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(2);
	});
});
