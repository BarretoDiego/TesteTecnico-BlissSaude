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
import { serviceTag, type ServiceDefinition } from "./defineService";
import { registerHealthRoute } from "./healthRoute";
import { setupSwagger } from "./swagger";

export interface CreateAppOptions extends ServiceDefinition {
	/** Prefixo de versão da API. Default: `API_PREFIX` (`/v1`). */
	apiPrefix?: string;
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
		/**
		 * Com prefixo de domínio, a rota raiz do serviço vira `/v1/requests/`. O
		 * contrato publicado é `POST /requests`, e um cliente HTTP qualquer não
		 * acrescenta a barra. Aceitar as duas formas é o comportamento esperado de
		 * uma API pública — sem isso, um `curl` sem barra recebe 404.
		 */
		ignoreTrailingSlash: true,
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
	// `/v1` + `/requests` = `/v1/requests`. Versão e domínio ficam separados para
	// que versionar a API não obrigue a tocar em nenhum arquivo de rotas.
	const prefix = `${options.apiPrefix ?? envService.getApiPrefix()}${options.routePrefix}`;
	const app = createInstance();

	await setupSwagger(app, {
		serviceName: options.name,
		description: options.description,
		tags: [{ name: serviceTag(options), description: options.description }],
	});
	await applyPlatform(app, options.name);

	// `/health` sob o prefixo do domínio (`/v1/requests/health`): cada Lambda
	// responde pela própria saúde no próprio caminho, sem colisão quando os
	// serviços sobem juntos e sem regra extra no API Gateway.
	await app.register(
		async (instance) => registerHealthRoute(instance, { serviceName: options.name, healthProbe: options.healthProbe }),
		{ prefix }
	);

	// O prefixo vai ao router como parâmetro, não só ao `register`: assim a
	// função de rotas conhece o agrupamento sob o qual está sendo montada e pode
	// declará-lo no log de inicialização e no verificador de paridade.
	await app.register(async (instance) => options.router(instance, { prefix, serviceName: options.name }), {
		prefix,
	});

	return app;
}
