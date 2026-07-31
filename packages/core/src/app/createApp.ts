/**
 * @module core/app/createApp
 *
 * Factory de aplicação Fastify compartilhada por todos os microserviços.
 *
 * Concentra o que **todo** serviço precisa fazer igual: normalizar o id de
 * correlação, entrar no contexto assíncrono, CORS, envelope de erro, rota de
 * saúde e o adaptador Lambda. Cada microserviço fornece apenas o que é seu — o
 * nome, o prefixo e a tabela de rotas.
 *
 * O ganho não é economia de linhas: é que a rastreabilidade por `requestId`
 * passa a ser propriedade da plataforma, e não algo que um serviço novo pode
 * esquecer de implementar.
 */

import fastifyCors from "@fastify/cors";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { EnvService } from "../config/EnvService";
import { DefaultErroHandler } from "../errors/DefaultErroHandler";
import { enterRequestContext } from "../utils/requestContext";
import { blissFail } from "../utils/responseEnvelope";
import { registerHealthRoute, type HealthProbe } from "./healthRoute";
import { setupSwagger } from "./swagger";

export interface CreateAppOptions {
	/** Nome do microserviço, ex.: `bliss-requests`. Vai para o Swagger e os logs. */
	serviceName: string;
	/** Descrição exibida no Swagger. */
	description: string;
	/** Prefixo das rotas do serviço, ex.: `/v1`. */
	prefix?: string;
	/** Tabela de rotas do domínio. */
	router: FastifyPluginAsync;
	/** Tags do OpenAPI. */
	tags?: Array<{ name: string; description: string }>;
	/**
	 * Verificação de dependências para o `/health`. Opcional: um serviço sem
	 * banco responde saudável só por estar de pé.
	 */
	healthProbe?: HealthProbe;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
	const prefix = options.prefix ?? EnvService.getApiPrefix();

	const app = fastify({
		/**
		 * O id vem do header quando presente. É o elo da cadeia: o interceptor do
		 * backoffice e o cliente da automação enviam o header, então um único id
		 * atravessa browser → API Gateway → Lambda → banco → log. Sem isso, cada
		 * camada geraria o seu e a correlação se perderia.
		 */
		genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) || randomUUID(),
		logger: { level: EnvService.getLogLevel() },
		// Sem isso o Fastify confia no socket e ignora o `x-forwarded-*` do API
		// Gateway, fazendo todo log registrar o IP interno da AWS.
		trustProxy: true,
		bodyLimit: 1024 * 1024,
	});

	await app.register(fastifyCors, {
		origin: EnvService.optional("CORS_ORIGIN", "*"),
		methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", REQUEST_ID_HEADER],
		exposedHeaders: [REQUEST_ID_HEADER],
	});

	await setupSwagger(app, options);

	/**
	 * Entrada no contexto assíncrono.
	 *
	 * A partir daqui logger, envelope e repositório enxergam o `requestId` sem
	 * recebê-lo por parâmetro. O header é devolvido já neste ponto para estar
	 * presente inclusive em erro emitido cedo.
	 */
	app.addHook("onRequest", async (req, reply) => {
		reply.header(REQUEST_ID_HEADER, req.id);
		enterRequestContext({
			requestId: req.id,
			method: req.method,
			route: req.routeOptions?.url,
			startedAt: Date.now(),
		});
	});

	app.setErrorHandler((error, req, reply) =>
		DefaultErroHandler(error, reply, req, { module: options.serviceName, action: "onError" })
	);

	app.setNotFoundHandler((req, reply) =>
		blissFail(reply, req, 404, {
			code: "REQUEST_NOT_FOUND",
			message: "Rota não encontrada",
			details: { method: req.method, url: req.url },
		})
	);

	// `/health` em todo serviço, sempre no mesmo caminho e no mesmo formato: um
	// healthcheck que varia por serviço é um healthcheck que ninguém automatiza.
	await app.register(async (instance) => registerHealthRoute(instance, options), { prefix });
	await app.register(options.router, { prefix });

	return app;
}
