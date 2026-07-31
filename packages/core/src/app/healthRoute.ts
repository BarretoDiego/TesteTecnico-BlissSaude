/**
 * @module core/app/healthRoute
 *
 * Rota `/health`, idêntica em todo microserviço.
 *
 * A sonda é injetada pelo serviço: quem tem banco verifica o banco, quem não tem
 * responde saudável por estar de pé. O que **não** varia é o caminho, o formato
 * da resposta e a semântica dos status — um healthcheck que muda de forma entre
 * serviços é um healthcheck que nenhum orquestrador consegue consumir.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { envService } from "../config/EnvService";
import { toJsonSchema } from "../utils/jsonSchema";
import { blissFail, blissSuccess, buildErrorResponseSchema } from "../utils/responseEnvelope";

/** Verificação de dependência. Deve lançar ou devolver `false` quando indisponível. */
export type HealthProbe = () => Promise<boolean>;

export const HealthDataSchema = z.object({
	service: z.string(),
	status: z.enum(["ok", "degraded"]),
	env: z.string(),
	dependencies: z.enum(["up", "down"]),
	uptimeSeconds: z.number(),
	version: z.string(),
});

export const HealthResponseSchema = z.object({
	success: z.literal(true),
	data: HealthDataSchema,
	requestId: z.string(),
	timestamp: z.string(),
});

const startedAt = Date.now();

interface HealthRouteOptions {
	serviceName: string;
	healthProbe?: HealthProbe;
}

export function registerHealthRoute(app: FastifyInstance, options: HealthRouteOptions): void {
	app.route({
		method: "GET",
		url: "/health",
		schema: {
			tags: ["health"],
			summary: "Verifica a saúde do serviço",
			description:
				"Retorna 200 quando o serviço responde e suas dependências estão acessíveis, " +
				"e 503 quando alguma dependência está fora.",
			response: {
				200: toJsonSchema(HealthResponseSchema),
				503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
			},
		},
		handler: async (req, reply) => {
			const base = {
				service: options.serviceName,
				env: envService.getEnv(),
				uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
				version: process.env.SERVICE_VERSION ?? "1.0.0",
			};

			// Sem sonda, o serviço não tem dependência externa a verificar.
			if (!options.healthProbe) {
				return blissSuccess(reply, req, { data: { status: "ok", dependencies: "up", ...base } });
			}

			try {
				// Verifica de fato: um healthcheck que não toca a dependência crítica
				// reporta "saudável" enquanto toda requisição real falha.
				await options.healthProbe();
				return blissSuccess(reply, req, { data: { status: "ok", dependencies: "up", ...base } });
			} catch (error) {
				// Sem este log, um health 503 não diz **por que** a dependência caiu —
				// e o healthcheck vira um alarme sem diagnóstico junto.
				req.log.error({ err: error, service: options.serviceName }, "sonda de saúde falhou");
				return blissFail(reply, req, 503, {
					code: "DATABASE_UNAVAILABLE",
					message: "Dependência indisponível no momento",
					details: { status: "degraded", dependencies: "down", ...base },
				});
			}
		},
	});
}
