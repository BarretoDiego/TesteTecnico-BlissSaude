/**
 * @module api/app
 *
 * Instância Fastify e adaptador Lambda.
 *
 * Concentra a fronteira HTTP: normalização do id de correlação, contexto
 * assíncrono, CORS, Swagger e o handler exportado para a AWS.
 */

import { EnvService } from "@/config/EnvService";
import { DefaultErroHandler } from "@/errors/DefaultErroHandler";
import router from "@/router";
import { enterRequestContext, runWithRequestContext } from "@/utils/requestContext";
import { sbFail } from "@/utils/responseEnvelope";
import awsLambdaFastify from "@fastify/aws-lambda";
import fastifyCors from "@fastify/cors";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { setupSwagger } from "./swagger";

export async function buildApp(): Promise<FastifyInstance> {
	const app = fastify({
		/**
		 * O id da requisição vem do header quando presente. É o elo da cadeia: o
		 * interceptor do backoffice e o cliente da automação enviam o header, então
		 * um único id atravessa browser → API Gateway → Lambda → banco → log.
		 * Sem isso, cada camada geraria o seu e a correlação se perderia.
		 */
		genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) || randomUUID(),
		logger: {
			level: EnvService.getLogLevel(),
			// Em local o pino já formata; em AWS o transporte é o console e o
			// SBLogger é quem emite as linhas estruturadas que consultamos.
			...(EnvService.isLocalEnv() ? {} : { base: undefined }),
		},
		// Sem isso o Fastify confia no socket e o `x-forwarded-*` do API Gateway
		// é ignorado, fazendo todo log registrar o IP interno da AWS.
		trustProxy: true,
		bodyLimit: 1024 * 1024,
	});

	await app.register(fastifyCors, {
		origin: EnvService.optional("CORS_ORIGIN", "*"),
		methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", REQUEST_ID_HEADER],
		exposedHeaders: [REQUEST_ID_HEADER],
	});

	await setupSwagger(app);

	/**
	 * Entrada no contexto assíncrono.
	 *
	 * A partir daqui, logger, envelope e repositório enxergam o `requestId` sem
	 * recebê-lo por parâmetro. O header também é devolvido já neste ponto para que
	 * esteja presente inclusive em resposta de erro emitida cedo.
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

	/** Handler de último recurso — garante envelope mesmo em erro fora de rota. */
	app.setErrorHandler((error, req, reply) =>
		DefaultErroHandler(error, reply, req, { module: "FastifyErrorHandler", action: "onError" })
	);

	app.setNotFoundHandler((req, reply) =>
		sbFail(reply, req, 404, {
			code: "REQUEST_NOT_FOUND",
			message: "Rota não encontrada",
			details: { method: req.method, url: req.url },
		})
	);

	await app.register(router, { prefix: EnvService.getApiPrefix() });

	return app;
}

/**
 * Proxy Lambda, criado uma vez por container.
 *
 * `callbackWaitsForEmptyEventLoop: false` é o que permite ao pool do Postgres
 * sobreviver entre invocações: sem ele, a Lambda esperaria o socket ocioso
 * fechar antes de retornar, pagando a duração e destruindo o pool a cada request.
 */
let proxyPromise: Promise<ReturnType<typeof awsLambdaFastify>> | undefined;

async function getProxy() {
	if (!proxyPromise) {
		proxyPromise = buildApp().then((app) =>
			awsLambdaFastify(app, {
				callbackWaitsForEmptyEventLoop: false,
				decorateRequest: false,
			})
		);
	}
	return proxyPromise;
}

/**
 * Handler exportado para a AWS.
 *
 * Faz duas coisas antes de delegar:
 *
 * 1. **Normaliza o id de correlação** com precedência deliberada — cliente vence
 *    o API Gateway, que vence o id da invocação. O cliente vencer é o que permite
 *    seguir um trace que começou no browser.
 * 2. **Envolve tudo em `runWithRequestContext`**. O `enterWith` do hook sozinho
 *    não basta: em container reutilizado ele deixa o store da invocação anterior
 *    vivo para qualquer trabalho assíncrono pendente, carimbando logs com o
 *    `requestId` errado.
 */
export const lambdaHandler = async (event: any, context: any, callback?: any) => {
	const headers = (event.headers ??= {});
	const requestId: string =
		headers[REQUEST_ID_HEADER] ||
		headers[REQUEST_ID_HEADER.toUpperCase()] ||
		event.requestContext?.requestId ||
		context?.awsRequestId ||
		randomUUID();
	headers[REQUEST_ID_HEADER] = requestId;

	const proxy = await getProxy();
	// O `callback` é repassado por completude da assinatura Lambda, mas o
	// @fastify/aws-lambda resolve pela promessa quando ele não é usado — que é o
	// caminho que este handler segue.
	return runWithRequestContext({ requestId, startedAt: Date.now() }, () => proxy(event, context, callback));
};

export default buildApp;
