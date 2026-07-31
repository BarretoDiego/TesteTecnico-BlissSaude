/**
 * Middlewares de validação do domínio de solicitações.
 *
 * Cobre as duas responsabilidades de cada um: rejeitar entrada inválida com 400
 * e **normalizar** a entrada válida. A segunda é a que costuma passar batida e é
 * a que quebra os filtros em produção.
 */

import { makeCreatePayload, makeFastifyRequest, makeReply, makeUuid } from "@saude-bliss/testing";
import { CreateRequestMiddleware } from "../../src/middlewares/CreateRequestMiddleware";
import { GetRequestMiddleware } from "../../src/middlewares/GetRequestMiddleware";
import { ListRequestsMiddleware } from "../../src/middlewares/ListRequestsMiddleware";

describe("CreateRequestMiddleware", () => {
	it("aceita um payload válido sem responder", async () => {
		const reply = makeReply();

		await CreateRequestMiddleware(makeFastifyRequest({ body: makeCreatePayload() }) as never, reply.reply);

		expect(reply.statusCode).toBeUndefined();
	});

	it("normaliza createdBy para minúsculas", async () => {
		const reply = makeReply();
		const req = makeFastifyRequest({ body: makeCreatePayload({ createdBy: "Ana.Souza@SaudeBliss.test" }) });

		await CreateRequestMiddleware(req as never, reply.reply);

		// Sem essa normalização, "Ana@x" e "ana@x" viram dois solicitantes
		// diferentes e o filtro `?createdBy=` passa a errar silenciosamente.
		expect((req.body as any).createdBy).toBe("ana.souza@saudebliss.test");
	});

	it("remove espaços das extremidades do título", async () => {
		const reply = makeReply();
		const req = makeFastifyRequest({ body: makeCreatePayload({ title: "   Título com espaços   " }) });

		await CreateRequestMiddleware(req as never, reply.reply);

		expect((req.body as any).title).toBe("Título com espaços");
	});

	it.each([
		["title", { title: "ab" }],
		["description", { description: "curta" }],
		["priority", { priority: "urgente" }],
		["createdBy", { createdBy: "não-é-email" }],
	])("retorna 400 quando %s é inválido", async (_field, override) => {
		const reply = makeReply();

		await CreateRequestMiddleware(
			makeFastifyRequest({ body: makeCreatePayload(override as never) }) as never,
			reply.reply
		);

		expect(reply.statusCode).toBe(400);
		expect(reply.payload.error.code).toBe("VALIDATION_ERROR");
	});

	it.each(["title", "description", "priority", "createdBy"])("retorna 400 quando %s está ausente", async (field) => {
		const reply = makeReply();
		const body = makeCreatePayload();
		delete (body as never as Record<string, unknown>)[field];

		await CreateRequestMiddleware(makeFastifyRequest({ body }) as never, reply.reply);

		expect(reply.statusCode).toBe(400);
	});

	it("rejeita status no payload em vez de ignorá-lo", async () => {
		const reply = makeReply();
		const body = { ...makeCreatePayload(), status: "reviewed" };

		await CreateRequestMiddleware(makeFastifyRequest({ body }) as never, reply.reply);

		// `status` é campo do servidor. Falhar alto evita a impressão de que o
		// cliente conseguiu definir o estado inicial.
		expect(reply.statusCode).toBe(400);
	});
});

describe("GetRequestMiddleware", () => {
	it("aceita um UUID válido", async () => {
		const reply = makeReply();

		await GetRequestMiddleware(makeFastifyRequest({ params: { id: makeUuid() } }) as never, reply.reply);

		expect(reply.statusCode).toBeUndefined();
	});

	it.each(["123", "não-é-uuid", ""])("retorna 400 para o id %p", async (id) => {
		const reply = makeReply();

		await GetRequestMiddleware(makeFastifyRequest({ params: { id } }) as never, reply.reply);

		// 400 e não 404: id malformado é erro do cliente, não recurso ausente.
		expect(reply.statusCode).toBe(400);
	});
});

describe("ListRequestsMiddleware", () => {
	it("aplica os defaults de paginação quando a query vem vazia", async () => {
		const reply = makeReply();
		const req = makeFastifyRequest({ query: {} });

		await ListRequestsMiddleware(req as never, reply.reply);

		expect(req.query).toMatchObject({ page: 1, pageSize: 20 });
	});

	it("converte page e pageSize de texto para número", async () => {
		const reply = makeReply();
		const req = makeFastifyRequest({ query: { page: "3", pageSize: "50" } });

		await ListRequestsMiddleware(req as never, reply.reply);

		// Query string sempre chega como texto; sem o coerce o Drizzle receberia
		// string em LIMIT/OFFSET.
		expect(req.query).toMatchObject({ page: 3, pageSize: 50 });
	});

	it("normaliza createdBy para minúsculas no filtro", async () => {
		const reply = makeReply();
		const req = makeFastifyRequest({ query: { createdBy: "Ana.Souza@SaudeBliss.test" } });

		await ListRequestsMiddleware(req as never, reply.reply);

		expect((req.query as any).createdBy).toBe("ana.souza@saudebliss.test");
	});

	it("aceita os filtros combinados", async () => {
		const reply = makeReply();
		const query = { status: "open", createdBy: "ana@saudebliss.test", priority: "high" };

		await ListRequestsMiddleware(makeFastifyRequest({ query }) as never, reply.reply);

		expect(reply.statusCode).toBeUndefined();
	});

	it("retorna 400 para um status fora do enum", async () => {
		const reply = makeReply();

		await ListRequestsMiddleware(makeFastifyRequest({ query: { status: "arquivado" } }) as never, reply.reply);

		expect(reply.statusCode).toBe(400);
	});

	it("retorna 400 quando pageSize passa do teto de 100", async () => {
		const reply = makeReply();

		await ListRequestsMiddleware(makeFastifyRequest({ query: { pageSize: "100000" } }) as never, reply.reply);

		// O teto existe para que um pageSize absurdo não vire table scan e derrube
		// o pool de conexões da Lambda.
		expect(reply.statusCode).toBe(400);
	});

	it("retorna 400 quando page é menor que 1", async () => {
		const reply = makeReply();

		await ListRequestsMiddleware(makeFastifyRequest({ query: { page: "0" } }) as never, reply.reply);

		expect(reply.statusCode).toBe(400);
	});
});
