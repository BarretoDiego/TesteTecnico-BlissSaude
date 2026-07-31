/**
 * @module bliss-requests/service
 *
 * Definição do microserviço.
 *
 * Um objeto só, consumido pelo `app.ts` (que vira a Lambda) e pelo
 * `run.all.local.ts` (que sobe todos os domínios num processo). É o que garante
 * que nome, prefixo e sonda de saúde sejam idênticos nos dois modos — quando
 * estavam declarados em dois lugares, podiam divergir sem ninguém notar.
 */

import { defineService } from "@saude-bliss/core";
import router, { ROUTE_PREFIX } from "./router";
import { RequestsService } from "./services/RequestsService";

export const service = defineService({
	name: "bliss-requests",
	description: "Abertura e consulta de solicitações (tickets).",
	routePrefix: ROUTE_PREFIX,
	router,
	// Verifica o banco de fato: um healthcheck que não toca a dependência
	// crítica reporta saudável enquanto toda requisição real falha.
	healthProbe: () => new RequestsService().checkDatabase(),
});

export { ROUTE_PREFIX };
