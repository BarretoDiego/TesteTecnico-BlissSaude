/**
 * @module bliss-requests/router
 *
 * Tabela de rotas do domínio de solicitações.
 *
 * Declara **apenas** o mapeamento rota → schema → middleware → handler. Nenhuma
 * lógica. É também a fonte que `scripts/check-route-parity.ts` compara com o
 * `serverless.yml` para detectar divergência entre as duas declarações de rota.
 */

import type { FastifyInstance } from "fastify";
import RequestsController from "../controllers/RequestsController";
import { CreateRequestMiddleware, CreateRequestSchema } from "../middlewares/CreateRequestMiddleware";
import { GetRequestMiddleware, GetRequestSchema } from "../middlewares/GetRequestMiddleware";
import { ListRequestsMiddleware, ListRequestsSchema } from "../middlewares/ListRequestsMiddleware";

export default async function router(app: FastifyInstance): Promise<void> {
	app.route({
		method: "POST",
		url: "/requests",
		schema: CreateRequestSchema,
		preValidation: [CreateRequestMiddleware],
		handler: RequestsController.create,
	});

	/**
	 * Declarada antes de `/requests/:id` de propósito. O Fastify usa roteador de
	 * árvore de prefixos e não depende de ordem, mas manter o específico acima do
	 * paramétrico deixa a intenção legível para quem lê o arquivo.
	 */
	app.route({
		method: "GET",
		url: "/requests",
		schema: ListRequestsSchema,
		// `preHandler`, não `preValidation`: o schema converte tipos (ver o
		// comentário no ListRequestsMiddleware).
		preHandler: [ListRequestsMiddleware],
		handler: RequestsController.list,
	});

	app.route({
		method: "GET",
		url: "/requests/:id",
		schema: GetRequestSchema,
		preValidation: [GetRequestMiddleware],
		handler: RequestsController.getById,
	});
}
