/**
 * @module bliss-auth/service
 *
 * Definição do microserviço.
 */

import { defineService } from "@saude-bliss/core";
import router, { ROUTE_PREFIX } from "./router";
import { AuthService } from "./services/AuthService";

export const service = defineService({
	name: "bliss-auth",
	description: "Autenticação — emissão, renovação e revogação de sessões.",
	routePrefix: ROUTE_PREFIX,
	router,
	healthProbe: () => new AuthService().checkDatabase(),
});

export { ROUTE_PREFIX };
