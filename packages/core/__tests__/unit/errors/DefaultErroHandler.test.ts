/**
 * Classificação de erros.
 *
 * A ordem em que o handler testa os casos é o que separa um 400 acionável de um
 * 500 opaco, então cada ramo tem um teste próprio.
 */

import type { ErrorCode } from "@saude-bliss/contracts";
import { makeFastifyRequest, makeReply } from "@saude-bliss/testing";
import { z } from "zod";
import { BlissError } from "../../../src/errors/BlissError";
import { ERROR_CATALOG } from "../../../src/errors/catalog";
import { DefaultErroHandler } from "../../../src/errors/DefaultErroHandler";

describe("DefaultErroHandler — erro de validação", () => {
	function makeZodError(): z.ZodError {
		const schema = z.object({ title: z.string().min(3, "Título muito curto"), age: z.number() });
		const result = schema.safeParse({ title: "ab", age: "x" });
		if (result.success) throw new Error("o schema deveria ter falhado");
		return result.error;
	}

	it("responde 400 com o código VALIDATION_ERROR", () => {
		const reply = makeReply();

		DefaultErroHandler(makeZodError(), reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(400);
		expect(reply.payload.success).toBe(false);
		expect(reply.payload.error.code).toBe("VALIDATION_ERROR");
	});

	it("detalha campo e mensagem de cada problema encontrado", () => {
		const reply = makeReply();

		DefaultErroHandler(makeZodError(), reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details).toEqual([
			{ field: "title", message: "Título muito curto" },
			{ field: "age", message: expect.stringContaining("number") },
		]);
	});

	it("identifica a raiz quando o problema não tem caminho", () => {
		const result = z.object({ a: z.string() }).strict().safeParse({ a: "x", extra: 1 });
		if (result.success) throw new Error("o schema deveria ter falhado");
		const reply = makeReply();

		DefaultErroHandler(result.error, reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details[0].field).toBe("(raiz)");
	});
});

describe("DefaultErroHandler — erro de domínio", () => {
	const codes = Object.keys(ERROR_CATALOG) as ErrorCode[];

	it.each(codes)("mapeia %s para o status HTTP do catálogo", (code) => {
		const reply = makeReply();

		DefaultErroHandler(BlissError.from(code), reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(ERROR_CATALOG[code].httpStatus);
		expect(reply.payload.error.code).toBe(code);
	});

	it("preserva os detalhes anexados ao erro", () => {
		const reply = makeReply();
		const id = "00000000-0000-4000-8000-000000000001";

		DefaultErroHandler(BlissError.from("REQUEST_NOT_FOUND", { details: { id } }), reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details).toEqual({ id });
	});

	it("não expõe a causa original na resposta", () => {
		const reply = makeReply();
		const cause = new Error("connect ECONNREFUSED 10.0.3.14:5432");

		DefaultErroHandler(BlissError.from("INTERNAL_ERROR", { cause }), reply.reply, makeFastifyRequest());

		expect(JSON.stringify(reply.payload)).not.toContain("ECONNREFUSED");
	});
});

describe("DefaultErroHandler — banco indisponível", () => {
	it.each(["08006", "57P01", "53300"])("traduz o código %s do Postgres para 503", (code) => {
		const reply = makeReply();

		DefaultErroHandler(Object.assign(new Error("falha de conexão"), { code }), reply.reply, makeFastifyRequest());

		// 503 e não 500: sinaliza ao cliente que a operação é retentável.
		expect(reply.statusCode).toBe(503);
		expect(reply.payload.error.code).toBe("DATABASE_UNAVAILABLE");
	});

	it("trata um código desconhecido do Postgres como erro interno", () => {
		const reply = makeReply();

		DefaultErroHandler(Object.assign(new Error("violação"), { code: "23505" }), reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(500);
	});
});

describe("DefaultErroHandler — erro desconhecido", () => {
	it("responde 500 com mensagem genérica", () => {
		const reply = makeReply();

		DefaultErroHandler(new Error("estourou algo interno"), reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(500);
		expect(reply.payload.error.code).toBe("INTERNAL_ERROR");
	});

	it("não vaza a mensagem original nem o stack trace", () => {
		const reply = makeReply();

		DefaultErroHandler(new Error("senha do banco: hunter2"), reply.reply, makeFastifyRequest());

		const body = JSON.stringify(reply.payload);
		expect(body).not.toContain("hunter2");
		expect(body).not.toContain("at Object");
	});

	it.each([null, undefined, "string solta", 42])("lida com o valor lançado %p sem quebrar", (thrown) => {
		const reply = makeReply();

		expect(() => DefaultErroHandler(thrown, reply.reply, makeFastifyRequest())).not.toThrow();
		expect(reply.statusCode).toBe(500);
	});
});

describe("DefaultErroHandler — envelope", () => {
	it("inclui requestId e timestamp em toda resposta de erro", () => {
		const reply = makeReply();

		DefaultErroHandler(BlissError.from("REQUEST_NOT_FOUND"), reply.reply, makeFastifyRequest({ id: "trace-abc" }));

		expect(reply.payload.requestId).toBe("trace-abc");
		expect(reply.payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(reply.headers["x-request-id"]).toBe("trace-abc");
	});
});

describe("BlissError", () => {
	it("expõe o status e a mensagem do catálogo", () => {
		const error = BlissError.from("REQUEST_NOT_FOUND");

		expect(error.httpStatus).toBe(404);
		expect(error.message).toBe(ERROR_CATALOG.REQUEST_NOT_FOUND.message);
	});

	it("aceita mensagem específica sobrescrevendo a do catálogo", () => {
		const error = BlissError.from("REQUEST_NOT_FOUND", { message: "Solicitação 42 sumiu" });

		expect(error.message).toBe("Solicitação 42 sumiu");
		expect(error.code).toBe("REQUEST_NOT_FOUND");
	});

	it("reconhece a própria instância", () => {
		expect(BlissError.isBlissError(BlissError.from("INTERNAL_ERROR"))).toBe(true);
		expect(BlissError.isBlissError(new Error("qualquer"))).toBe(false);
	});

	it("omite cause e stack na forma serializável", () => {
		const detail = BlissError.from("INTERNAL_ERROR", { cause: new Error("interno"), details: { a: 1 } }).toDetail();

		expect(detail).toEqual({ code: "INTERNAL_ERROR", message: expect.any(String), details: { a: 1 } });
		expect(detail).not.toHaveProperty("cause");
	});
});
