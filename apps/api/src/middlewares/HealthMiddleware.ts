/**
 * @module api/middlewares/HealthMiddleware
 *
 * `GET /health` — schema do healthcheck. Sem validação de entrada: a rota não
 * recebe parâmetros. O arquivo existe para manter a simetria da estrutura, de
 * modo que toda rota tenha seu schema declarado no mesmo lugar.
 */

import { toJsonSchema } from "@/utils/jsonSchema";
import { buildErrorResponseSchema } from "@/utils/responseEnvelope";
import { z } from "zod";

export const HealthDataSchema = z.object({
	status: z.enum(["ok", "degraded"]),
	env: z.string(),
	database: z.enum(["up", "down"]),
	uptimeSeconds: z.number(),
	version: z.string(),
});

export const HealthResponseSchema = z.object({
	success: z.literal(true),
	data: HealthDataSchema,
	requestId: z.string(),
	timestamp: z.string(),
});

export const HealthSchema = {
	tags: ["health"],
	summary: "Verifica a saúde da API",
	description:
		"Retorna 200 quando a API responde e o banco está acessível, e 503 quando o banco está fora. " +
		"Usado pelo smoke test da automação e pelo script de deploy local.",
	response: {
		200: toJsonSchema(HealthResponseSchema),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
