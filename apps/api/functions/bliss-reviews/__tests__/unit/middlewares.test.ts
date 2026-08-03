/**
 * Validação de entrada da conferência.
 *
 * O middleware roda antes do controller e **substitui** `req.params` e
 * `req.body` pelo valor já normalizado. Duas coisas precisam valer: entrada
 * inválida vira 400 com detalhe por campo, e entrada válida chega ao controller
 * transformada — não como veio.
 */

import { makeFastifyRequest, makeReply } from "@saude-bliss/testing";
import type { FastifyReply, FastifyRequest } from "fastify";
import { GetTimelineMiddleware, GetTimelineSchema } from "../../src/middlewares/GetTimelineMiddleware";
import { ReviewRequestMiddleware, ReviewRequestSchema } from "../../src/middlewares/ReviewRequestMiddleware";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Requisição com `params` e `body` controlados, como o Fastify a entrega. */
function makeRequest(params: unknown, body?: unknown) {
	const req = makeFastifyRequest() as unknown as FastifyRequest & { params: unknown; body: unknown };
	req.params = params;
	req.body = body;
	return req;
}

const corpoValido = { reviewedBy: "daniel@saudebliss.test", status: "reviewed" as const };

describe("ReviewRequestMiddleware — entrada válida", () => {
	it("deixa passar sem responder", async () => {
		const reply = makeReply();
		const req = makeRequest({ id: UUID }, corpoValido);

		const resultado = await ReviewRequestMiddleware(req as never, reply.reply as FastifyReply);

		// Middleware que responde encerra a requisição. Devolver `undefined` é o
		// que permite o controller assumir daqui.
		expect(resultado).toBeUndefined();
		expect(reply.statusCode).toBeUndefined();
	});

	it("normaliza o e-mail de quem conferiu", async () => {
		const req = makeRequest({ id: UUID }, { ...corpoValido, reviewedBy: "  DANIEL@SaudeBliss.test " });

		await ReviewRequestMiddleware(req as never, makeReply().reply as FastifyReply);

		// O controller lê `req.body` já normalizado — é o que mantém o
		// `reviewed_by` consistente no banco.
		expect((req.body as { reviewedBy: string }).reviewedBy).toBe("daniel@saudebliss.test");
	});

	it("apara a observação", async () => {
		const req = makeRequest({ id: UUID }, { ...corpoValido, note: "  conferido  " });

		await ReviewRequestMiddleware(req as never, makeReply().reply as FastifyReply);

		expect((req.body as { note: string }).note).toBe("conferido");
	});

	it.each(["reviewed", "rejected"])("aceita o desfecho %s", async (status) => {
		const reply = makeReply();

		await ReviewRequestMiddleware(
			makeRequest({ id: UUID }, { ...corpoValido, status }) as never,
			reply.reply as FastifyReply
		);

		expect(reply.statusCode).toBeUndefined();
	});
});

describe("ReviewRequestMiddleware — entrada inválida", () => {
	it.each([
		["id que não é UUID", { id: "abc" }, corpoValido],
		["id ausente", {}, corpoValido],
		["corpo vazio", { id: UUID }, {}],
		["sem quem conferiu", { id: UUID }, { status: "reviewed" }],
		["e-mail malformado", { id: UUID }, { ...corpoValido, reviewedBy: "não-é-email" }],
		["status intermediário", { id: UUID }, { ...corpoValido, status: "in_review" }],
		["status inventado", { id: UUID }, { ...corpoValido, status: "arquivada" }],
		["campo desconhecido", { id: UUID }, { ...corpoValido, reviewedAt: "hoje" }],
		["observação longa demais", { id: UUID }, { ...corpoValido, note: "a".repeat(501) }],
	])("responde 400 para %s", async (_caso, params, body) => {
		const reply = makeReply();

		await ReviewRequestMiddleware(makeRequest(params, body) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
		expect(reply.payload.error.code).toBe("VALIDATION_ERROR");
	});

	it("valida o id antes do corpo", async () => {
		const reply = makeReply();

		// Com os dois inválidos, o id precisa aparecer: é o que distingue "rota
		// errada" de "corpo errado" para quem está depurando o cliente.
		await ReviewRequestMiddleware(makeRequest({ id: "abc" }, {}) as never, reply.reply as FastifyReply);

		expect(JSON.stringify(reply.payload.error.details)).toContain("id");
	});

	it("aponta o campo exato do corpo", async () => {
		const reply = makeReply();

		await ReviewRequestMiddleware(
			makeRequest({ id: UUID }, { ...corpoValido, reviewedBy: "x" }) as never,
			reply.reply as FastifyReply
		);

		expect(reply.payload.error.details).toEqual(
			expect.arrayContaining([expect.objectContaining({ field: "reviewedBy" })])
		);
	});

	it("não deixa o corpo pela metade quando recusa", async () => {
		const req = makeRequest({ id: UUID }, { status: "arquivada" });

		await ReviewRequestMiddleware(req as never, makeReply().reply as FastifyReply);

		// Substituir `req.body` por um parse parcial faria o controller receber
		// dado inválido caso alguém esquecesse de checar o retorno.
		expect(req.body).toEqual({ status: "arquivada" });
	});
});

describe("GetTimelineMiddleware", () => {
	it("deixa passar id válido", async () => {
		const reply = makeReply();

		const resultado = await GetTimelineMiddleware(makeRequest({ id: UUID }) as never, reply.reply as FastifyReply);

		expect(resultado).toBeUndefined();
		expect(reply.statusCode).toBeUndefined();
	});

	it.each([
		["texto solto", "nao-e-uuid"],
		["número", "12345"],
		["UUID truncado", UUID.slice(0, 20)],
		["vazio", ""],
	])("responde 400 para %s", async (_caso, id) => {
		const reply = makeReply();

		// 400 e não 404: deixar passar levaria o valor ao Postgres, que devolveria
		// erro de tipo — um 500 no lugar de um 400.
		await GetTimelineMiddleware(makeRequest({ id }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});

	it("recusa parâmetro extra na rota", async () => {
		const reply = makeReply();

		await GetTimelineMiddleware(makeRequest({ id: UUID, extra: "x" }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});
});

describe("schemas de documentação", () => {
	it("declaram os status que cada rota responde", () => {
		// O Swagger é lido por quem integra. Faltando um status, quem consome não
		// sabe que precisa tratá-lo.
		expect(Object.keys(ReviewRequestSchema.response)).toEqual(expect.arrayContaining(["200", "400", "404", "409"]));
		expect(Object.keys(GetTimelineSchema.response)).toEqual(expect.arrayContaining(["200", "400", "404"]));
	});

	it("agrupam as rotas sob a tag do domínio", () => {
		expect(ReviewRequestSchema.tags).toEqual(["reviews"]);
		expect(GetTimelineSchema.tags).toEqual(["reviews"]);
	});

	it("descrevem o propósito de cada rota", () => {
		for (const schema of [ReviewRequestSchema, GetTimelineSchema]) {
			expect(schema.summary).toBeTruthy();
			expect(schema.description).toBeTruthy();
		}
	});

	it("declaram o parâmetro de rota", () => {
		expect(ReviewRequestSchema.params).toBeTruthy();
		expect(GetTimelineSchema.params).toBeTruthy();
	});

	it("declaram o corpo apenas onde há corpo", () => {
		expect(ReviewRequestSchema.body).toBeTruthy();
		expect(GetTimelineSchema).not.toHaveProperty("body");
	});
});
