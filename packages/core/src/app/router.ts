/**
 * @module core/app/router
 *
 * Contrato das funções de rota dos microserviços.
 *
 * Um router recebe o **prefixo sob o qual está sendo montado**. Isso resolve duas
 * coisas que o `register(router, { prefix })` sozinho não resolve: a função de
 * rotas passa a saber o caminho completo que expõe — útil no log de
 * inicialização e no verificador de paridade contra o `serverless.yml` — e o
 * agrupamento fica explícito no arquivo de rotas em vez de escondido no chamador.
 */

import type { FastifyInstance } from "fastify";

export interface RouterOptions {
	/** Prefixo sob o qual as rotas estão montadas, ex.: `/v1`. */
	prefix: string;
	/** Microserviço dono das rotas, ex.: `bliss-requests`. */
	serviceName: string;
}

/** Assinatura de toda função de rotas de domínio. */
export type DomainRouter = (app: FastifyInstance, options: RouterOptions) => Promise<void>;

/** Uma rota declarada, para log e verificação de paridade. */
export interface RouteDescriptor {
	method: string;
	/** Caminho relativo ao prefixo, ex.: `/requests/:id`. */
	path: string;
}

/**
 * Registra o mapa de rotas do serviço.
 *
 * Emitido uma vez na inicialização, com o caminho completo já resolvido — é o
 * que permite conferir num relance se um serviço subiu expondo o que deveria,
 * sem precisar abrir o Swagger.
 */
export function describeRoutes(app: FastifyInstance, options: RouterOptions, routes: readonly RouteDescriptor[]): void {
	app.log.info(
		{
			service: options.serviceName,
			prefix: options.prefix,
			routes: routes.map((route) => `${route.method} ${options.prefix}${route.path}`),
		},
		`rotas de ${options.serviceName} montadas em ${options.prefix}`
	);
}
