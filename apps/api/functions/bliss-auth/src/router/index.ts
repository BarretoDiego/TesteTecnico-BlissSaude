/**
 * @module bliss-auth/router
 *
 * Tabela de rotas do domínio de autenticação.
 *
 * `login`, `refresh` e `logout` são **públicas** por definição: quem as chama
 * ainda não tem token. `me` exige token — é a única rota autenticada deste
 * serviço. A distinção é declarada no mapa `routes` do módulo Terraform.
 */

import { describeRoutes, type RouteDescriptor, type RouterOptions } from "@saude-bliss/core";
import type { FastifyInstance } from "fastify";
import AuthController from "../controllers/AuthController";
import {
	LoginMiddleware,
	LoginSchema,
	LogoutMiddleware,
	LogoutSchema,
	MeSchema,
	RefreshMiddleware,
	RefreshSchema,
} from "../middlewares/AuthMiddlewares";

export const ROUTE_PREFIX = "/auth";

/** Rotas expostas, relativas ao prefixo. */
export const ROUTES: readonly RouteDescriptor[] = [
	{ method: "POST", path: "/login" },
	{ method: "POST", path: "/refresh" },
	{ method: "POST", path: "/logout" },
	{ method: "GET", path: "/me" },
];

export default async function router(app: FastifyInstance, options: RouterOptions): Promise<void> {
	app.route({
		method: "POST",
		url: "/login",
		schema: LoginSchema,
		preValidation: [LoginMiddleware],
		handler: AuthController.login,
	});

	app.route({
		method: "POST",
		url: "/refresh",
		schema: RefreshSchema,
		preValidation: [RefreshMiddleware],
		handler: AuthController.refresh,
	});

	app.route({
		method: "POST",
		url: "/logout",
		schema: LogoutSchema,
		preValidation: [LogoutMiddleware],
		handler: AuthController.logout,
	});

	app.route({
		method: "GET",
		url: "/me",
		schema: MeSchema,
		handler: AuthController.me,
	});

	describeRoutes(app, options, ROUTES);
}
