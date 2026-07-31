/**
 * Contrato HTTP do microserviço de conferência.
 *
 * `app.inject()` com o repositório mockado: exercita router, middleware,
 * controller e envelope sem socket nem banco.
 */

import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import { makeEvent, makeRequest } from "@saude-bliss/testing";
import type { FastifyInstance } from "fastify";

const repository = {
	findById: jest.fn(),
	findEventsByRequestId: jest.fn().mockResolvedValue([]),
	updateStatus: jest.fn(),
	ping: jest.fn().mockResolvedValue(true),
};

jest.mock("../../src/repositories/ReviewsRepository", () => ({
	ReviewsRepository: jest.fn().mockImplementation(() => repository),
}));

let app: FastifyInstance;
const ID = "00000000-0000-4000-8000-000000000001";
const validBody = { reviewedBy: "daniel.morais@saudebliss.test", status: "reviewed" };

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
	repository.findEventsByRequestId.mockResolvedValue([]);
});

describe("PATCH /requests/{id}/review", () => {
	it("responde 200 com o envelope e a solicitação conferida", async () => {
		const current = makeRequest({ id: ID, status: "open" });
		repository.findById.mockResolvedValue(current);
		repository.updateStatus.mockResolvedValue(makeRequest({ ...current, status: "reviewed" }));

		const response = await app.inject({ method: "PATCH", url: `/v1/requests/${ID}/review`, payload: validBody });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			success: true,
			data: { status: "reviewed" },
			message: "Conferência registrada com sucesso",
		});
	});

	it("responde 404 quando a solicitação não existe", async () => {
		repository.findById.mockResolvedValue(null);

		const response = await app.inject({ method: "PATCH", url: `/v1/requests/${ID}/review`, payload: validBody });

		expect(response.statusCode).toBe(404);
		expect(response.json().error.code).toBe("REQUEST_NOT_FOUND");
	});

	it("responde 409 quando a solicitação já foi conferida", async () => {
		repository.findById.mockResolvedValue(makeRequest({ id: ID, status: "reviewed" }));

		const response = await app.inject({ method: "PATCH", url: `/v1/requests/${ID}/review`, payload: validBody });

		expect(response.statusCode).toBe(409);
		expect(response.json().error.code).toBe("REQUEST_ALREADY_REVIEWED");
	});

	it.each([
		["status intermediário", { ...validBody, status: "in_review" }],
		["reviewedBy sem e-mail", { ...validBody, reviewedBy: "daniel" }],
		["campo desconhecido", { ...validBody, aprovado: true }],
	])("responde 400 com %s", async (_case, payload) => {
		const response = await app.inject({ method: "PATCH", url: `/v1/requests/${ID}/review`, payload });

		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("VALIDATION_ERROR");
	});

	it("responde 400 quando o id da rota não é um UUID", async () => {
		const response = await app.inject({ method: "PATCH", url: "/v1/requests/abc/review", payload: validBody });

		// 400 e não 404: id malformado é erro do cliente, não recurso ausente.
		expect(response.statusCode).toBe(400);
	});
});

describe("GET /requests/{id}/timeline", () => {
	it("responde 200 com os eventos da solicitação", async () => {
		repository.findById.mockResolvedValue(makeRequest({ id: ID }));
		repository.findEventsByRequestId.mockResolvedValue([
			makeEvent({ requestId: ID, type: "reviewed", fromStatus: "open", toStatus: "reviewed" }),
			makeEvent({ requestId: ID, type: "created" }),
		]);

		const response = await app.inject({ method: "GET", url: `/v1/requests/${ID}/timeline` });

		expect(response.statusCode).toBe(200);
		expect(response.json().data.events).toHaveLength(2);
	});

	it("responde 404 quando a solicitação não existe", async () => {
		repository.findById.mockResolvedValue(null);

		const response = await app.inject({ method: "GET", url: `/v1/requests/${ID}/timeline` });

		expect(response.statusCode).toBe(404);
	});
});

describe("rastreabilidade", () => {
	it("propaga o requestId do header para o envelope e de volta para o header", async () => {
		repository.findById.mockResolvedValue(makeRequest({ id: ID }));

		const response = await app.inject({
			method: "GET",
			url: `/v1/requests/${ID}/timeline`,
			headers: { [REQUEST_ID_HEADER]: "trace-reviews-001" },
		});

		expect(response.json().requestId).toBe("trace-reviews-001");
		expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-reviews-001");
	});

	it("mantém o requestId no envelope de erro", async () => {
		repository.findById.mockResolvedValue(null);

		const response = await app.inject({
			method: "PATCH",
			url: `/v1/requests/${ID}/review`,
			headers: { [REQUEST_ID_HEADER]: "trace-reviews-erro" },
			payload: validBody,
		});

		expect(response.json().requestId).toBe("trace-reviews-erro");
	});
});

describe("health", () => {
	it("identifica o próprio serviço na resposta", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/health" });

		expect(response.json().data).toMatchObject({ service: "bliss-reviews", status: "ok", dependencies: "up" });
	});

	it("responde 503 quando o banco está inacessível", async () => {
		repository.ping.mockRejectedValue(new Error("sem conexão"));

		const response = await app.inject({ method: "GET", url: "/v1/health" });

		expect(response.statusCode).toBe(503);
	});
});

describe("fronteira do microserviço", () => {
	it.each([
		["POST", "/v1/requests"],
		["GET", "/v1/requests"],
		["GET", "/v1/requests/00000000-0000-4000-8000-000000000001"],
	])("não expõe %s %s — pertence ao bliss-requests", async (method, url) => {
		const response = await app.inject({ method: method as "POST" | "GET", url, payload: {} });

		expect(response.statusCode).toBe(404);
	});
});
