/**
 * Rastreabilidade por requestId — requisito explícito do desafio.
 *
 * Verifica que **um único id** atravessa a requisição inteira e aparece nos
 * quatro lugares que importam: header de resposta, envelope, linhas de log e a
 * coluna persistida. O modo de falha que isto previne é sutil e caro: cada
 * camada gerar o próprio id, de modo que os logs parecem corretos até alguém
 * tentar correlacionar um incidente e descobrir que não dá.
 *
 * Roda com `app.inject()` — sem socket, sem banco.
 */

import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import { makeEvent, makeRequest } from "@saude-bliss/testing";
import type { FastifyInstance } from "fastify";

const repository = {
	insert: jest.fn(),
	findById: jest.fn(),
	findEventsByRequestId: jest.fn().mockResolvedValue([]),
	list: jest.fn(),
	ping: jest.fn().mockResolvedValue(true),
};

jest.mock("../../src/repositories/RequestsRepository", () => ({
	RequestsRepository: jest.fn().mockImplementation(() => repository),
}));

let app: FastifyInstance;

beforeAll(async () => {
	const { buildApp } = await import("../../src/app");
	app = await buildApp();
	await app.ready();
});

afterAll(async () => {
	await app.close();
});

beforeEach(() => {
	repository.ping.mockResolvedValue(true);
	repository.list.mockResolvedValue({ items: [], total: 0 });
	repository.findEventsByRequestId.mockResolvedValue([]);
});

const validPayload = {
	title: "Solicitação de teste",
	description: "Descrição suficientemente longa para passar na validação.",
	priority: "high",
	createdBy: "ana.souza@saudebliss.test",
};

describe("propagação do requestId informado pelo cliente", () => {
	it("devolve no envelope o mesmo id enviado no header", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/requests",
			headers: { [REQUEST_ID_HEADER]: "trace-do-cliente" },
		});

		expect(response.json().requestId).toBe("trace-do-cliente");
	});

	it("ecoa o id no header de resposta", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/requests",
			headers: { [REQUEST_ID_HEADER]: "trace-do-cliente" },
		});

		expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-do-cliente");
	});

	it("usa o mesmo id no header e no envelope", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/requests",
			headers: { [REQUEST_ID_HEADER]: "trace-do-cliente" },
		});

		// A asserção que importa: os dois canais precisam concordar, senão
		// correlacionar do browser até o log deixa de funcionar.
		expect(response.headers[REQUEST_ID_HEADER]).toBe(response.json().requestId);
	});

	it("persiste o id como trace da solicitação criada", async () => {
		// O repositório lê o id do AsyncLocalStorage, sem recebê-lo por parâmetro.
		const { getRequestId } = await import("@saude-bliss/core");
		let observed: string | undefined;
		repository.insert.mockImplementation(async () => {
			observed = getRequestId();
			return makeRequest({ createdTraceId: observed ?? null });
		});

		await app.inject({
			method: "POST",
			url: "/v1/requests",
			headers: { [REQUEST_ID_HEADER]: "trace-persistido" },
			payload: validPayload,
		});

		expect(observed).toBe("trace-persistido");
	});
});

describe("geração do requestId quando o cliente não informa", () => {
	it("gera um id e o expõe no envelope e no header", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/requests" });

		const fromEnvelope = response.json().requestId;
		expect(fromEnvelope).toEqual(expect.any(String));
		expect(fromEnvelope).not.toHaveLength(0);
		expect(response.headers[REQUEST_ID_HEADER]).toBe(fromEnvelope);
	});

	it("gera ids distintos para requisições distintas", async () => {
		const [first, second] = await Promise.all([
			app.inject({ method: "GET", url: "/v1/requests" }),
			app.inject({ method: "GET", url: "/v1/requests" }),
		]);

		expect(first.json().requestId).not.toBe(second.json().requestId);
	});
});

describe("rastreabilidade em resposta de erro", () => {
	it("mantém o requestId no envelope de 404", async () => {
		repository.findById.mockResolvedValue(null);

		const response = await app.inject({
			method: "GET",
			url: "/v1/requests/00000000-0000-4000-8000-000000000001",
			headers: { [REQUEST_ID_HEADER]: "trace-do-404" },
		});

		// Justamente quando dá erro é que alguém precisa correlacionar com o log.
		expect(response.statusCode).toBe(404);
		expect(response.json().requestId).toBe("trace-do-404");
		expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-do-404");
	});

	it("mantém o requestId no envelope de 400", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/requests",
			headers: { [REQUEST_ID_HEADER]: "trace-do-400" },
			payload: { title: "ab" },
		});

		expect(response.statusCode).toBe(400);
		expect(response.json().requestId).toBe("trace-do-400");
	});

	it("mantém o requestId em rota inexistente", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/dominio-que-nao-existe",
			headers: { [REQUEST_ID_HEADER]: "trace-do-not-found" },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json().requestId).toBe("trace-do-not-found");
	});
});

describe("contrato dos endpoints", () => {
	it("responde 201 na criação, com envelope e mensagem", async () => {
		const created = makeRequest();
		repository.insert.mockResolvedValue(created);

		const response = await app.inject({ method: "POST", url: "/v1/requests", payload: validPayload });

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			success: true,
			data: { id: created.id, status: "open" },
			message: "Solicitação criada com sucesso",
		});
	});

	it("responde 200 com a solicitação e sua linha do tempo na consulta por id", async () => {
		const found = makeRequest();
		const events = [makeEvent({ requestId: found.id })];
		repository.findById.mockResolvedValue(found);
		repository.findEventsByRequestId.mockResolvedValue(events);

		const response = await app.inject({ method: "GET", url: `/v1/requests/${found.id}` });

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toMatchObject({ id: found.id, events: [{ id: events[0]!.id }] });
	});

	it("responde 200 com itens e paginação na listagem", async () => {
		repository.list.mockResolvedValue({ items: [makeRequest()], total: 1 });

		const response = await app.inject({ method: "GET", url: "/v1/requests?status=open" });

		expect(response.statusCode).toBe(200);
		expect(response.json().data.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
	});

	it("repassa os filtros da query string ao repositório já normalizados", async () => {
		repository.list.mockResolvedValue({ items: [], total: 0 });

		await app.inject({ method: "GET", url: "/v1/requests?status=open&createdBy=Ana%40SaudeBliss.test&page=2" });

		// `status` chega como texto e sai como lista de um elemento: o filtro aceita
		// vários, e normalizar na borda evita o repositório ter que decidir a forma.
		expect(repository.list).toHaveBeenCalledWith(
			expect.objectContaining({ status: ["open"], createdBy: "ana@saudebliss.test", page: 2 })
		);
	});

	it("aceita vários status separados por vírgula", async () => {
		repository.list.mockResolvedValue({ items: [], total: 0 });

		// A forma que a fila de conferência usa. Precisa atravessar a validação de
		// query string do Fastify, que roda antes do middleware — é por isso que o
		// schema declara `status` como string na entrada.
		const response = await app.inject({ method: "GET", url: "/v1/requests?status=open,in_review" });

		expect(response.statusCode).toBe(200);
		expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ status: ["open", "in_review"] }));
	});

	it("recusa status desconhecido dentro da lista", async () => {
		repository.list.mockResolvedValue({ items: [], total: 0 });

		const response = await app.inject({ method: "GET", url: "/v1/requests?status=open,inventado" });

		// Aceitar em silêncio devolveria só as abertas e pareceria funcionar — o
		// pior desfecho possível para um filtro digitado errado.
		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("VALIDATION_ERROR");
		expect(repository.list).not.toHaveBeenCalled();
	});

	it("responde 503 no health quando o banco está inacessível", async () => {
		repository.ping.mockRejectedValue(Object.assign(new Error("sem conexão"), { code: "08006" }));

		const response = await app.inject({ method: "GET", url: "/v1/requests/health" });

		expect(response.statusCode).toBe(503);
		expect(response.json().error.code).toBe("DATABASE_UNAVAILABLE");
	});

	it("responde 200 no health quando o banco responde", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/requests/health" });

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toMatchObject({ service: "bliss-requests", status: "ok", dependencies: "up" });
	});
});

describe("fronteira do microserviço", () => {
	it.each([
		["PATCH", "/v1/reviews/00000000-0000-4000-8000-000000000001"],
		["GET", "/v1/reviews/00000000-0000-4000-8000-000000000001/timeline"],
	])("não expõe %s %s — pertence ao bliss-reviews", async (method, url) => {
		const response = await app.inject({ method: method as "PATCH" | "GET", url, payload: {} });

		expect(response.statusCode).toBe(404);
	});
});

describe("propagação de falha inesperada", () => {
	it.each([
		["POST", "/v1/requests", "insert"],
		["GET", "/v1/requests", "list"],
		["GET", `/v1/requests/00000000-0000-4000-8000-000000000001`, "findById"],
	] as const)("responde 500 sem vazar detalhe quando %s %s falha", async (method, url, op) => {
		(repository as Record<string, jest.Mock>)[op]!.mockRejectedValue(new Error("senha do banco: hunter2"));

		const response = await app.inject({
			method: method as "POST" | "GET",
			url,
			payload: method === "POST" ? validPayload : undefined,
			headers: { [REQUEST_ID_HEADER]: "trace-do-500" },
		});

		expect(response.statusCode).toBe(500);
		expect(response.json().error.code).toBe("INTERNAL_ERROR");
		// O requestId continua sendo o elo com o log, que tem o detalhe completo.
		expect(response.json().requestId).toBe("trace-do-500");
		expect(response.body).not.toContain("hunter2");
	});

	it("traduz indisponibilidade do banco em 503 retentável", async () => {
		repository.list.mockRejectedValue(Object.assign(new Error("sem conexão"), { code: "08006" }));

		const response = await app.inject({ method: "GET", url: "/v1/requests" });

		expect(response.statusCode).toBe(503);
		expect(response.json().error.code).toBe("DATABASE_UNAVAILABLE");
	});
});

describe("agrupamento por prefixo de domínio", () => {
	it("expõe a raiz do domínio sem exigir barra final", async () => {
		repository.list.mockResolvedValue({ items: [], total: 0 });

		// O desafio especifica `GET /requests`; nenhum cliente HTTP acrescenta a
		// barra que o prefixo do Fastify criaria.
		const [semBarra, comBarra] = await Promise.all([
			app.inject({ method: "GET", url: "/v1/requests" }),
			app.inject({ method: "GET", url: "/v1/requests/" }),
		]);

		expect(semBarra.statusCode).toBe(200);
		expect(comBarra.statusCode).toBe(200);
	});

	it("resolve /requests/health como healthcheck, não como id de solicitação", async () => {
		// `/health` e `/:id` convivem sob o mesmo prefixo porque o roteador do
		// Fastify prefere rota estática à paramétrica. Se essa precedência mudasse,
		// o healthcheck passaria a ser tratado como consulta e devolveria 400.
		const response = await app.inject({ method: "GET", url: "/v1/requests/health" });

		expect(response.statusCode).toBe(200);
		expect(response.json().data.service).toBe("bliss-requests");
	});

	it("não responde fora do prefixo do domínio", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/reviews/health" });

		// Cada Lambda atende só o próprio prefixo — é o que permite ao API Gateway
		// rotear por um recurso `{proxy+}` por função.
		expect(response.statusCode).toBe(404);
	});
});
