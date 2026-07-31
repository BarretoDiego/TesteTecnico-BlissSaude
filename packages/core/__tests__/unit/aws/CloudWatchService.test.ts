/**
 * Métricas customizadas.
 *
 * Duas propriedades importam: telemetria com falha nunca derruba a operação que
 * estava sendo medida, e toda métrica sai com as dimensões de serviço e
 * ambiente — sem elas um gráfico mistura dev e produção e não serve para nada.
 */

import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from "@aws-sdk/client-cloudwatch";
import { mockClient } from "aws-sdk-client-mock";
import { resetAwsClients } from "../../../src/aws/AwsClientFactory";
import { CloudWatchService } from "../../../src/aws/CloudWatchService";

const cloudWatchMock = mockClient(CloudWatchClient);
const ORIGINAL = { ...process.env };

/** Em `local` sem endpoint o serviço não publica — é o cenário que se testa à parte. */
function servicoPublicante(nome = "bliss-requests") {
	process.env.AWS_ENDPOINT_URL = "http://localhost:4568";
	resetAwsClients();
	return new CloudWatchService(nome);
}

function metricaEnviada(indice = 0) {
	const chamadas = cloudWatchMock.commandCalls(PutMetricDataCommand);
	const dados = (chamadas[0]!.args[0].input as { MetricData: unknown[] }).MetricData;
	return dados[indice] as {
		MetricName: string;
		Value: number;
		Unit: string;
		Dimensions: Array<{ Name: string; Value: string }>;
	};
}

beforeEach(() => {
	cloudWatchMock.reset();
	resetAwsClients();
	cloudWatchMock.on(PutMetricDataCommand).resolves({});
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("CloudWatchService.putMetrics", () => {
	it("não chama a API para lista vazia", async () => {
		await servicoPublicante().putMetrics([]);

		expect(cloudWatchMock.calls()).toHaveLength(0);
	});

	it("não publica em ambiente local sem endpoint", async () => {
		delete process.env.AWS_ENDPOINT_URL;
		resetAwsClients();

		await new CloudWatchService("bliss-requests").putMetrics([{ name: "RequestsCreated", value: 1 }]);

		// Sem CloudWatch para receber, tentar só produziria ruído de erro a cada
		// operação durante o desenvolvimento.
		expect(cloudWatchMock.calls()).toHaveLength(0);
	});

	it("carimba serviço e ambiente em toda métrica", async () => {
		await servicoPublicante("bliss-reviews").putMetrics([{ name: "ReviewsCompleted", value: 3 }]);

		expect(metricaEnviada().Dimensions).toEqual(
			expect.arrayContaining([
				{ Name: "Service", Value: "bliss-reviews" },
				{ Name: "Environment", Value: "local" },
			])
		);
	});

	it("soma as dimensões específicas às padrão", async () => {
		await servicoPublicante().putMetrics([{ name: "X", value: 1, dimensions: { Priority: "critical" } }]);

		expect(metricaEnviada().Dimensions).toHaveLength(3);
		expect(metricaEnviada().Dimensions).toContainEqual({ Name: "Priority", Value: "critical" });
	});

	it("usa None como unidade padrão", async () => {
		await servicoPublicante().putMetrics([{ name: "X", value: 1 }]);

		expect(metricaEnviada().Unit).toBe(StandardUnit.None);
	});

	it("fatia em chamadas de no máximo 20 métricas", async () => {
		const metricas = Array.from({ length: 45 }, (_, index) => ({ name: `M${index}`, value: index }));

		await servicoPublicante().putMetrics(metricas);

		// `PutMetricData` recusa mais de 20 — sem o fatiamento, 45 métricas viram
		// uma chamada rejeitada inteira.
		expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(3);
	});

	it("não lança quando a publicação falha", async () => {
		cloudWatchMock.on(PutMetricDataCommand).rejects(new Error("throttling"));

		// Telemetria com falha derrubando a operação medida seria o pior dos dois
		// mundos: perde-se a métrica **e** o trabalho.
		await expect(servicoPublicante().putMetrics([{ name: "X", value: 1 }])).resolves.toBeUndefined();
	});
});

describe("CloudWatchService — atalhos", () => {
	it("count publica com unidade Count e valor 1 por padrão", async () => {
		await servicoPublicante().count("RequestsCreated");

		expect(metricaEnviada()).toMatchObject({ MetricName: "RequestsCreated", Value: 1, Unit: StandardUnit.Count });
	});

	it("count aceita valor e dimensões", async () => {
		await servicoPublicante().count("RequestsCreated", 5, { Priority: "high" });

		expect(metricaEnviada()).toMatchObject({ Value: 5 });
		expect(metricaEnviada().Dimensions).toContainEqual({ Name: "Priority", Value: "high" });
	});

	it("duration publica em milissegundos", async () => {
		await servicoPublicante().duration("ListLatency", 142);

		expect(metricaEnviada()).toMatchObject({
			MetricName: "ListLatency",
			Value: 142,
			Unit: StandardUnit.Milliseconds,
		});
	});
});
