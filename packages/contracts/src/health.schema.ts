/**
 * @module contracts/health.schema
 *
 * Formato da resposta de `/health`, idêntico em todo microserviço.
 *
 * Mora aqui, e não no `core`, porque tem dois lados: o `core` produz a resposta e
 * o backoffice a consome na tela de status. Deixá-lo no `core` obrigaria o front
 * a importar o runtime do backend — Fastify e SDK da AWS junto — para tipar seis
 * campos.
 */

import { z } from "zod";

export const HealthDataSchema = z.object({
	service: z.string(),
	status: z.enum(["ok", "degraded"]),
	env: z.string(),
	dependencies: z.enum(["up", "down"]),
	uptimeSeconds: z.number(),
	version: z.string(),
});
export type HealthData = z.infer<typeof HealthDataSchema>;
