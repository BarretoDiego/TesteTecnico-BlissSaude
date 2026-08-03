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

describe("DefaultErroHandler — validação do Fastify", () => {
	/**
	 * Forma do erro que o Ajv produz no estágio `preValidation` — antes de
	 * qualquer middleware. Sem reconhecê-lo, toda rota com schema declarado
	 * devolvia **500** para entrada inválida do cliente.
	 */
	const fastifyError = (validation: Array<{ instancePath?: string; message?: string }>, validationContext?: string) =>
		({ validation, ...(validationContext ? { validationContext } : {}) }) as unknown;

	it("responde 400, e não 500", () => {
		const reply = makeReply();

		DefaultErroHandler(
			fastifyError([{ instancePath: "/status", message: "deve ser um dos valores permitidos" }], "querystring"),
			reply.reply,
			makeFastifyRequest()
		);

		expect(reply.statusCode).toBe(400);
		expect(reply.payload.error.code).toBe("VALIDATION_ERROR");
	});

	it("compõe o contexto com o caminho para nomear o campo", () => {
		const reply = makeReply();

		DefaultErroHandler(
			fastifyError([{ instancePath: "/status", message: "inválido" }], "querystring"),
			reply.reply,
			makeFastifyRequest()
		);

		// "querystring.status" é acionável; "/status" sozinho não diz de onde veio.
		expect(reply.payload.error.details).toEqual([{ field: "querystring.status", message: "inválido" }]);
	});

	it("achata caminhos aninhados com ponto", () => {
		const reply = makeReply();

		DefaultErroHandler(
			fastifyError([{ instancePath: "/filtro/status", message: "inválido" }], "body"),
			reply.reply,
			makeFastifyRequest()
		);

		expect(reply.payload.error.details).toEqual([{ field: "body.filtro.status", message: "inválido" }]);
	});

	it("usa (raiz) quando não há caminho nem contexto", () => {
		const reply = makeReply();

		// Acontece quando o corpo inteiro é do tipo errado — um array onde se
		// esperava objeto. Campo vazio na resposta não ajudaria ninguém.
		DefaultErroHandler(fastifyError([{ message: "deve ser objeto" }]), reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details).toEqual([{ field: "(raiz)", message: "deve ser objeto" }]);
	});

	it("preenche mensagem padrão quando o Ajv não fornece uma", () => {
		const reply = makeReply();

		DefaultErroHandler(fastifyError([{ instancePath: "/x" }], "body"), reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details).toEqual([{ field: "body.x", message: "valor inválido" }]);
	});

	it("não confunde objeto cujo `validation` não é lista", () => {
		const reply = makeReply();

		// A checagem é `Array.isArray`, e não a mera presença da chave: um erro
		// qualquer com `validation: "algo"` cairia no ramo errado.
		DefaultErroHandler({ validation: "não é lista" }, reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(500);
	});
});

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

describe("DefaultErroHandler — falha declarada pelo Fastify", () => {
	/** Forma do erro que o Fastify lança para corpo malformado. */
	const erroDoFastify = (statusCode: number, code: string) => ({ statusCode, code, message: "corpo inválido" });

	it("traduz JSON malformado em 400, e não 500", () => {
		const reply = makeReply();

		// O Fastify já classifica: `statusCode: 400`. Sem reconhecer isso, um
		// corpo quebrado do cliente virava defeito do servidor no alarme.
		DefaultErroHandler(erroDoFastify(400, "FST_ERR_CTP_INVALID_JSON"), reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(400);
		expect(reply.payload.error.code).toBe("VALIDATION_ERROR");
	});

	it("informa o código do framework nos detalhes", () => {
		const reply = makeReply();

		DefaultErroHandler(erroDoFastify(400, "FST_ERR_CTP_INVALID_JSON"), reply.reply, makeFastifyRequest());

		// Sem isso a resposta diz "payload inválido" sem dizer o que estava errado.
		expect(reply.payload.error.details).toEqual({ reason: "FST_ERR_CTP_INVALID_JSON" });
	});

	it.each([
		["content-type não suportado", 415, "FST_ERR_CTP_INVALID_MEDIA_TYPE"],
		["payload grande demais", 413, "FST_ERR_CTP_BODY_TOO_LARGE"],
	])("também reconhece %s", (_caso, statusCode, code) => {
		const reply = makeReply();

		DefaultErroHandler(erroDoFastify(statusCode, code), reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(400);
	});

	it("não captura erro com statusCode de servidor", () => {
		const reply = makeReply();

		// 5xx é defeito nosso e precisa continuar caindo no catch-all, que loga
		// tudo e não vaza nada.
		DefaultErroHandler({ statusCode: 503, code: "FST_ERR_ALGO" }, reply.reply, makeFastifyRequest());

		expect(reply.statusCode).toBe(500);
	});

	it("usa a mensagem quando não há código", () => {
		const reply = makeReply();

		DefaultErroHandler({ statusCode: 400, message: "corpo ausente" }, reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details).toEqual({ reason: "corpo ausente" });
	});

	it("descreve genericamente quando não há código nem mensagem", () => {
		const reply = makeReply();

		// Um erro 4xx sem `code` e sem `message` — o Fastify produz isso em alguns
		// caminhos de parsing. Sem o texto padrão o detalhe sairia `undefined`, e a
		// linha de log ficaria sem o único campo que explicaria a rejeição.
		DefaultErroHandler({ statusCode: 400 }, reply.reply, makeFastifyRequest());

		expect(reply.payload.error.details).toEqual({ reason: "requisição inválida" });
	});

	it("não confunde BlissError, que usa httpStatus", () => {
		const reply = makeReply();

		// `BlissError` carrega `httpStatus`, não `statusCode`. Confundir os dois
		// faria todo erro de domínio 4xx perder o próprio código.
		DefaultErroHandler(BlissError.from("REQUEST_NOT_FOUND"), reply.reply, makeFastifyRequest());

		expect(reply.payload.error.code).toBe("REQUEST_NOT_FOUND");
		expect(reply.statusCode).toBe(404);
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
