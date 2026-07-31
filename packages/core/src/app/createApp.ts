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
 *
 * `createApp` (um domínio, uma Lambda) e `createAggregatedApp` (todos os
 * domínios num processo, para desenvolvimento) compartilham `applyPlatform`,
 * então os dois modos se comportam de forma idêntica. Se divergissem, o loop de
 * desenvolvimento deixaria de ser representativo do que roda em produção.
 */

import fastifyCors from "@fastify/cors";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { envService } from "../config/EnvService";
import { DefaultErroHandler } from "../errors/DefaultErroHandler";
import { enterRequestContext } from "../utils/requestContext";
import { blissFail } from "../utils/responseEnvelope";
import { registerHealthRoute, type HealthProbe } from "./healthRoute";
import type { DomainRouter } from "./router";
import { setupSwagger } from "./swagger";

export interface CreateAppOptions {
	/** Nome do microserviço, ex.: `bliss-requests`. Vai para o Swagger e os logs. */
	serviceName: string;
	/** Descrição exibida no Swagger. */
	description: string;
	/** Prefixo das rotas do serviço, ex.: `/v1`. */
	prefix?: string;
	/** Tabela de rotas do domínio. */
	router: DomainRouter;
	/** Tags do OpenAPI. */
	tags?: Array<{ name: string; description: string }>;
	/**
	 * Verificação de dependências para o `/health`. Opcional: um serviço sem
	 * banco responde saudável só por estar de pé.
	 */
	healthProbe?: HealthProbe;
}

/** Instância Fastify com as opções que todo serviço usa igual. */
function createInstance(): FastifyInstance {
	return fastify({
		/**
		 * O id da requisição vem do header quando presente. É o elo da cadeia: o
		 * interceptor do backoffice e o cliente da automação enviam o header, então
		 * um único id atravessa browser → API Gateway → Lambda → banco → log. Sem
		 * isso, cada camada geraria o seu e a correlação se perderia.
		 */
		genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) || randomUUID(),
		logger: { level: envService.getLogLevel() },
		// Sem isso o Fastify confia no socket e ignora o `x-forwarded-*` do API
		// Gateway, fazendo todo log registrar o IP interno da AWS.
		trustProxy: true,
		bodyLimit: 1024 * 1024,
	});
}

/**
 * Aplica o comportamento de plataforma: CORS, contexto de requisição, handlers
 * de erro e de rota não encontrada.
 *
 * Extraído para que `createApp` e `createAggregatedApp` não possam divergir.
 */
export async function applyPlatform(app: FastifyInstance, moduleName: string): Promise<void> {
	await app.register(fastifyCors, {
		origin: envService.optional("CORS_ORIGIN", "*"),
		methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", REQUEST_ID_HEADER],
		exposedHeaders: [REQUEST_ID_HEADER],
	});

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
		DefaultErroHandler(error, reply, req, { module: moduleName, action: "onError" })
	);

	app.setNotFoundHandler((req, reply) =>
		blissFail(reply, req, 404, {
			code: "REQUEST_NOT_FOUND",
			message: "Rota não encontrada",
			details: { method: req.method, url: req.url },
		})
	);
}

/** Aplicação de um microserviço — o que vai para dentro de uma Lambda. */
export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
	const prefix = options.prefix ?? envService.getApiPrefix();
	const app = createInstance();

	await setupSwagger(app, options);
	await applyPlatform(app, options.serviceName);

	// `/health` em todo serviço, sempre no mesmo caminho e no mesmo formato: um
	// healthcheck que varia por serviço é um healthcheck que ninguém automatiza.
	await app.register(async (instance) => registerHealthRoute(instance, options), { prefix });

	// O prefixo vai ao router como parâmetro, não só ao `register`: assim a
	// função de rotas conhece o agrupamento sob o qual está sendo montada e pode
	// declará-lo no log de inicialização e no verificador de paridade.
	await app.register(async (instance) => options.router(instance, { prefix, serviceName: options.serviceName }), {
		prefix,
	});

	return app;
}
