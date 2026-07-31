/**
 * @module testing/fastifyMocks
 *
 * Duplos de `FastifyRequest` e `FastifyReply` para testes unitários.
 *
 * Os middlewares e o `DefaultErroHandler` usam uma fatia pequena da superfície do
 * Fastify. Um duplo explícito documenta exatamente qual é essa fatia e roda em
 * ordens de grandeza menos tempo que subir um servidor.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

export interface ReplyDouble {
	reply: FastifyReply;
	/** Último status enviado. */
	statusCode: number | undefined;
	/** Último corpo enviado. */
	payload: any;
	headers: Record<string, string>;
}

/** `FastifyReply` encadeável que grava o que foi enviado. */
export function makeReply(): ReplyDouble {
	const state: ReplyDouble = {
		reply: null as unknown as FastifyReply,
		statusCode: undefined,
		payload: undefined,
		headers: {},
	};

	const reply = {
		code(status: number) {
			state.statusCode = status;
			return this;
		},
		header(name: string, value: string) {
			state.headers[name] = value;
			return this;
		},
		send(payload: unknown) {
			state.payload = payload;
			return this;
		},
	};

	state.reply = reply as unknown as FastifyReply;
	return state;
}

export interface RequestDoubleOptions {
	id?: string;
	body?: unknown;
	params?: unknown;
	query?: unknown;
	headers?: Record<string, string>;
	method?: string;
	url?: string;
}

export function makeFastifyRequest(options: RequestDoubleOptions = {}): FastifyRequest {
	return {
		id: options.id ?? "req-teste",
		body: options.body,
		params: options.params ?? {},
		query: options.query ?? {},
		headers: options.headers ?? {},
		method: options.method ?? "GET",
		url: options.url ?? "/v1/requests",
	} as unknown as FastifyRequest;
}
