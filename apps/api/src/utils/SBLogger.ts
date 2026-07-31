/**
 * @module api/utils/SBLogger
 *
 * Logger estruturado.
 *
 * Cada chamada emite **um único objeto JSON por linha** com `requestId` no nível
 * raiz. É isso que faz o CloudWatch Logs Insights conseguir
 * `filter requestId = "..."` sem expressão de parse — a diferença entre
 * correlacionar um incidente em segundos ou em minutos.
 *
 * O `requestId` vem do `AsyncLocalStorage`, nunca de parâmetro: por isso services
 * e repositories não precisam receber `req`.
 */

import { EnvService } from "@/config/EnvService";
import { getElapsedMs, getRequestId } from "./requestContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

export interface LogParams {
	[key: string]: unknown;
}

/** Serializa `Error` — `JSON.stringify` de um Error puro produz `{}`. */
function normalizeParams(params?: LogParams): LogParams | undefined {
	if (!params) return undefined;

	const output: LogParams = {};
	for (const [key, value] of Object.entries(params)) {
		if (value instanceof Error) {
			output[key] = {
				name: value.name,
				message: value.message,
				// Stack só em ambiente local: em produção vaza caminho de arquivo
				// e estrutura interna para quem tiver acesso ao log.
				...(EnvService.isLocalEnv() ? { stack: value.stack } : {}),
			};
			continue;
		}
		output[key] = value;
	}
	return output;
}

export class SBLogger {
	private readonly minWeight: number;

	constructor(level: LogLevel = (EnvService.getLogLevel() as LogLevel) ?? "info") {
		this.minWeight = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info;
	}

	log(level: LogLevel, module: string, action: string, message: string, params?: LogParams): void {
		if (LEVEL_WEIGHT[level] < this.minWeight) return;

		const entry = {
			level,
			timestamp: new Date().toISOString(),
			requestId: getRequestId(),
			module,
			action,
			message,
			durationMs: getElapsedMs(),
			...normalizeParams(params),
		};

		// `console` de propósito: em Lambda é o transporte nativo para o CloudWatch,
		// e um stream próprio só adicionaria risco de perder linhas no freeze do
		// container entre invocações.
		const line = JSON.stringify(entry);
		if (level === "error") {
			console.error(line);
			return;
		}
		if (level === "warn") {
			console.warn(line);
			return;
		}
		console.log(line);
	}
}

/** Instância compartilhada — o nível é lido do ambiente uma única vez. */
export const logger = new SBLogger();
