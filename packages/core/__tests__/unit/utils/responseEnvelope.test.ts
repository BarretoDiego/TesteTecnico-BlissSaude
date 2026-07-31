/**
 * Envelope de resposta.
 *
 * Toda resposta da API passa por aqui, o que garante que `requestId` e
 * `timestamp` nunca sejam esquecidos em um endpoint novo — e é isso que precisa
 * ser verificado.
 */

import { makeFastifyRequest, makeReply } from "@saude-bliss/testing";
import { z } from "zod";
import { toJsonSchema } from "../../../src/utils/jsonSchema";
import { runWithRequestContext } from "../../../src/utils/requestContext";
import {
	blissFail,
	blissSuccess,
	buildErrorResponseSchema,
	resolveRequestId,
} from "../../../src/utils/responseEnvelope";

describe("blissSuccess", () => {
	it("responde 200 por padrão com o envelope completo", () => {
		const reply = makeReply();

		blissSuccess(reply.reply, makeFastifyRequest({ id: "trace-1" }), { data: { id: 7 } });

		expect(reply.statusCode).toBe(200);
		expect(reply.payload).toEqual({
			success: true,
			data: { id: 7 },
			requestId: "trace-1",
			timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
	});

	it("respeita o status informado", () => {
		const reply = makeReply();

		blissSuccess(reply.reply, makeFastifyRequest(), { data: {}, statusCode: 201 });

		expect(reply.statusCode).toBe(201);
	});

	it("inclui a mensagem apenas quando informada", () => {
		const comMensagem = makeReply();
		const semMensagem = makeReply();

		blissSuccess(comMensagem.reply, makeFastifyRequest(), { data: {}, message: "Criado" });
		blissSuccess(semMensagem.reply, makeFastifyRequest(), { data: {} });

		expect(comMensagem.payload.message).toBe("Criado");
		expect(semMensagem.payload).not.toHaveProperty("message");
	});

	it("também expõe o requestId no header", () => {
		const reply = makeReply();

		blissSuccess(reply.reply, makeFastifyRequest({ id: "trace-1" }), { data: {} });

		// Redundância deliberada: nem todo cliente lê headers com facilidade, e
		// nem todo log de cliente registra o corpo.
		expect(reply.headers["x-request-id"]).toBe("trace-1");
	});
});

describe("blissFail", () => {
	it("monta o envelope de erro com o status informado", () => {
		const reply = makeReply();

		blissFail(reply.reply, makeFastifyRequest({ id: "trace-2" }), 409, {
			code: "REQUEST_ALREADY_REVIEWED",
			message: "Já conferida",
			details: { id: "abc" },
		});

		expect(reply.statusCode).toBe(409);
		expect(reply.payload).toEqual({
			success: false,
			error: { code: "REQUEST_ALREADY_REVIEWED", message: "Já conferida", details: { id: "abc" } },
			requestId: "trace-2",
			timestamp: expect.any(String),
		});
	});
});

describe("resolveRequestId", () => {
	it("prefere o contexto assíncrono", () => {
		const req = makeFastifyRequest({ id: "do-req", headers: { "x-request-id": "do-header" } });

		const resolved = runWithRequestContext({ requestId: "do-contexto", startedAt: Date.now() }, () =>
			resolveRequestId(req)
		);

		expect(resolved).toBe("do-contexto");
	});

	it("cai para o id do request fora do contexto", () => {
		// Acontece quando `onError` dispara antes do hook `onRequest` completar —
		// melhor um id do `req` do que nenhum id.
		expect(resolveRequestId(makeFastifyRequest({ id: "do-req" }))).toBe("do-req");
	});

	it("cai para o header quando não há id no request", () => {
		const req = makeFastifyRequest({ headers: { "x-request-id": "do-header" } });
		(req as { id?: string }).id = undefined;

		expect(resolveRequestId(req)).toBe("do-header");
	});

	it("devolve unknown quando não há nenhuma fonte", () => {
		const req = makeFastifyRequest();
		(req as { id?: string }).id = undefined;

		// Nunca `undefined`: um envelope sem `requestId` quebra o contrato que o
		// consumidor espera poder ler sempre.
		expect(resolveRequestId(req)).toBe("unknown");
	});
});

describe("buildErrorResponseSchema", () => {
	it("restringe o enum de códigos aos informados", () => {
		const schema = buildErrorResponseSchema(["REQUEST_NOT_FOUND", "VALIDATION_ERROR"]);

		expect(schema.properties.error.properties.code.enum).toEqual(["REQUEST_NOT_FOUND", "VALIDATION_ERROR"]);
		expect(schema.required).toEqual(["success", "error", "requestId", "timestamp"]);
	});
});

describe("toJsonSchema", () => {
	it("converte um schema Zod para JSON Schema", () => {
		const schema = toJsonSchema(z.object({ nome: z.string(), idade: z.number().optional() }));

		expect(schema).toMatchObject({
			type: "object",
			properties: { nome: { type: "string" }, idade: { type: "number" } },
			required: ["nome"],
		});
	});

	it("usa o dialeto OpenAPI 3 — sem `$schema` no resultado", () => {
		// O Fastify rejeita `$schema` no objeto de rota; é por isso que o target
		// é openApi3 e não o default.
		expect(toJsonSchema(z.object({ a: z.string() }))).not.toHaveProperty("$schema");
	});
});
