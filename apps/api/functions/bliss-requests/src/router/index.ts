/**
 * @module bliss-requests/router
 *
 * Tabela de rotas do domínio de solicitações.
 *
 * Declara **apenas** o mapeamento rota → schema → middleware → handler. Nenhuma
 * lógica. Recebe o prefixo sob o qual está sendo montado, o que torna o
 * agrupamento do microserviço explícito aqui em vez de escondido no chamador —
 * e permite registrar o mapa completo de rotas na inicialização.
 *
 * `ROUTES` é também a fonte que `scripts/check-route-parity.ts` compara com o
 * `serverless.yml`, para detectar divergência entre as duas declarações de rota.
 */

import { describeRoutes, type RouteDescriptor, type RouterOptions } from "@saude-bliss/core";
import type { FastifyInstance } from "fastify";
import RequestsController from "../controllers/RequestsController";
import { CreateRequestMiddleware, CreateRequestSchema } from "../middlewares/CreateRequestMiddleware";
import { GetRequestMiddleware, GetRequestSchema } from "../middlewares/GetRequestMiddleware";
import { ListRequestsMiddleware, ListRequestsSchema } from "../middlewares/ListRequestsMiddleware";

/**
 * Prefixo do domínio. Todas as rotas deste microserviço vivem sob ele, e é o
 * caminho que o API Gateway encaminha inteiro para esta Lambda.
 */
export const ROUTE_PREFIX = "/requests";

/** Rotas expostas, relativas ao prefixo. */
export const ROUTES: readonly RouteDescriptor[] = [
	{ method: "POST", path: "/" },
	{ method: "GET", path: "/" },
	{ method: "GET", path: "/:id" },
];

export default async function router(app: FastifyInstance, options: RouterOptions): Promise<void> {
	app.route({
		method: "POST",
		url: "/",
		schema: CreateRequestSchema,
		preValidation: [CreateRequestMiddleware],
		handler: RequestsController.create,
	});

	/**
	 * Declarada antes de `/:id` de propósito. O Fastify usa roteador de
	 * árvore de prefixos e não depende de ordem, mas manter o específico acima do
	 * paramétrico deixa a intenção legível para quem lê o arquivo.
	 */
	app.route({
		method: "GET",
		url: "/",
		schema: ListRequestsSchema,
		// `preHandler`, não `preValidation`: o schema converte tipos (ver o
		// comentário no ListRequestsMiddleware).
		preHandler: [ListRequestsMiddleware],
		handler: RequestsController.list,
	});

	app.route({
		method: "GET",
		url: "/:id",
		schema: GetRequestSchema,
		preValidation: [GetRequestMiddleware],
		handler: RequestsController.getById,
	});

	describeRoutes(app, options, ROUTES);
}
