/**
 * @module core/aws/CloudWatchService
 *
 * Métricas customizadas no CloudWatch.
 *
 * Complementa os logs estruturados: log responde "o que aconteceu nesta
 * requisição", métrica responde "como está o sistema agora". Alarme se constrói
 * sobre métrica, não sobre log — Logs Insights é caro e lento para servir de
 * gatilho.
 *
 * As dimensões padrão (serviço e ambiente) entram em toda métrica, senão um
 * gráfico de `RequestsCreated` mistura dev e produção e não serve para nada.
 */

import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from "@aws-sdk/client-cloudwatch";
import { BaseService } from "../common/BaseService";
import { envService } from "../config/EnvService";
import { getAwsClient } from "./AwsClientFactory";

const MODULE = "CloudWatchService";

/** Limite da API: `PutMetricData` aceita no máximo 20 métricas por chamada. */
const MAX_METRICS_PER_CALL = 20;

const NAMESPACE = "SaudeBliss";

export interface Metric {
	name: string;
	value: number;
	unit?: StandardUnit;
	/** Dimensões específicas, somadas às padrão (serviço e ambiente). */
	dimensions?: Record<string, string>;
}

export class CloudWatchService extends BaseService {
	constructor(private readonly serviceName: string = process.env.SERVICE_NAME ?? "unknown") {
		super();
	}

	private get client(): CloudWatchClient {
		return getAwsClient("cloudwatch", (config) => new CloudWatchClient(config));
	}

	/**
	 * Publica métricas.
	 *
	 * Não lança: telemetria com falha nunca deve derrubar a operação que estava
	 * sendo medida. É o mesmo raciocínio do EventBridge e do SQS.
	 */
	async putMetrics(metrics: readonly Metric[]): Promise<void> {
		if (metrics.length === 0) return;

		// Em local não há CloudWatch para receber; tentar só produziria ruído de
		// erro a cada operação durante o desenvolvimento.
		if (envService.isLocalEnv() && !envService.getAwsEndpoint()) {
			this.logInfo(MODULE, "putMetrics", "métricas ignoradas em ambiente local", {
				names: metrics.map((metric) => metric.name),
			});
			return;
		}

		const timestamp = new Date();
		const baseDimensions = [
			{ Name: "Service", Value: this.serviceName },
			{ Name: "Environment", Value: envService.getEnv() },
		];

		for (let index = 0; index < metrics.length; index += MAX_METRICS_PER_CALL) {
			const slice = metrics.slice(index, index + MAX_METRICS_PER_CALL);

			try {
				await this.client.send(
					new PutMetricDataCommand({
						Namespace: NAMESPACE,
						MetricData: slice.map((metric) => ({
							MetricName: metric.name,
							Value: metric.value,
							Unit: metric.unit ?? StandardUnit.None,
							Timestamp: timestamp,
							Dimensions: [
								...baseDimensions,
								...Object.entries(metric.dimensions ?? {}).map(([Name, Value]) => ({ Name, Value })),
							],
						})),
					})
				);
			} catch (error) {
				this.logError(MODULE, "putMetrics", "falha ao publicar métricas", { error, count: slice.length });
			}
		}
	}

	/** Contador — o caso mais comum. */
	async count(name: string, value = 1, dimensions?: Record<string, string>): Promise<void> {
		await this.putMetrics([{ name, value, unit: StandardUnit.Count, dimensions }]);
	}

	/** Duração em milissegundos. */
	async duration(name: string, milliseconds: number, dimensions?: Record<string, string>): Promise<void> {
		await this.putMetrics([{ name, value: milliseconds, unit: StandardUnit.Milliseconds, dimensions }]);
	}
}

export const cloudWatchService = new CloudWatchService();
