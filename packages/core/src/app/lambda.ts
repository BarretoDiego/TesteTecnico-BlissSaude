/**
 * @module core/app/lambda
 *
 * Adaptador AWS Lambda.
 *
 * Um handler por microserviço, cada um empacotado na própria função Lambda —
 * assim o domínio inteiro escala, faz deploy e é observado como uma unidade, e
 * uma latência no domínio de conferência não consome a concorrência do domínio
 * de abertura de solicitações.
 */

import awsLambdaFastify from "@fastify/aws-lambda";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../utils/requestContext";

type Proxy = ReturnType<typeof awsLambdaFastify>;

/**
 * Cria o handler Lambda de um microserviço.
 *
 * O proxy é construído uma vez por container e reaproveitado. Combinado com
 * `callbackWaitsForEmptyEventLoop: false`, é o que permite ao pool do Postgres
 * sobreviver entre invocações: sem isso a Lambda esperaria o socket ocioso
 * fechar antes de retornar, pagando a duração e destruindo o pool a cada request.
 */
export function createLambdaHandler(buildApp: () => Promise<FastifyInstance>) {
	let proxyPromise: Promise<Proxy> | undefined;

	const getProxy = (): Promise<Proxy> => {
		// A promessa em cache também deduplica: em cold start com invocações
		// concorrentes, sem ela dois apps seriam construídos e um vazaria.
		proxyPromise ??= buildApp().then((app) =>
			awsLambdaFastify(app, {
				callbackWaitsForEmptyEventLoop: false,
				decorateRequest: false,
			})
		);
		return proxyPromise;
	};

	/**
	 * Handler exportado para a AWS.
	 *
	 * Faz duas coisas antes de delegar:
	 *
	 * 1. **Normaliza o id de correlação** com precedência deliberada — cliente
	 *    vence o API Gateway, que vence o id da invocação. O cliente vencer é o
	 *    que permite seguir um trace que começou no browser.
	 * 2. **Envolve tudo em `runWithRequestContext`**. O `enterWith` do hook
	 *    sozinho não basta: em container reutilizado ele deixa o store da
	 *    invocação anterior vivo para trabalho assíncrono pendente, carimbando
	 *    logs com o `requestId` errado.
	 */
	return async (event: any, context: any, callback?: any) => {
		const headers = (event.headers ??= {});
		const requestId: string =
			headers[REQUEST_ID_HEADER] ||
			headers[REQUEST_ID_HEADER.toUpperCase()] ||
			event.requestContext?.requestId ||
			context?.awsRequestId ||
			randomUUID();
		headers[REQUEST_ID_HEADER] = requestId;

		const proxy = await getProxy();
		return runWithRequestContext({ requestId, startedAt: Date.now() }, () => proxy(event, context, callback));
	};
}
