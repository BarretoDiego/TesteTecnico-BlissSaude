/**
 * @module api/utils/requestContext
 *
 * Contexto de requisição via `AsyncLocalStorage`.
 *
 * Existe para que logger, envelope e repositories acessem o `requestId` sem que
 * ele precise atravessar toda assinatura de função. A alternativa — passar `req`
 * para service e repository — polui a camada de domínio com um tipo de HTTP e
 * torna qualquer refatoração cara.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
	/** Id de correlação que atravessa browser → API Gateway → Lambda → banco → log. */
	requestId: string;
	method?: string;
	route?: string;
	/** `Date.now()` na entrada — usado para calcular `durationMs` nos logs. */
	startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Executa `fn` dentro de um contexto novo.
 *
 * Usado na fronteira da Lambda. Diferente de `enterRequestContext`, garante que
 * o store seja destruído ao final — sem isso, um container reutilizado carrega o
 * contexto da invocação anterior para qualquer trabalho assíncrono pendente, e
 * logs saem carimbados com o `requestId` errado.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

/**
 * Entra no contexto sem envolver um callback.
 *
 * Necessário nos hooks do Fastify, que não expõem ponto de wrap. É seguro aqui
 * porque `onRequest` já roda dentro do escopo assíncrono da própria requisição.
 */
export function enterRequestContext(context: RequestContext): void {
	storage.enterWith(context);
}

/** Contexto atual, ou `undefined` fora de uma requisição (ex.: scripts, seed). */
export function getRequestContext(): RequestContext | undefined {
	return storage.getStore();
}

/** `requestId` atual, ou `undefined` fora de uma requisição. */
export function getRequestId(): string | undefined {
	return storage.getStore()?.requestId;
}

/** Milissegundos desde o início da requisição. `undefined` fora de uma. */
export function getElapsedMs(): number | undefined {
	const context = storage.getStore();
	return context ? Date.now() - context.startedAt : undefined;
}
