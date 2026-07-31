/**
 * Regras de domínio das solicitações.
 *
 * O repositório é um duplo: estes testes cobrem decisão de negócio, e amarrá-los
 * a um banco tornaria lento justamente o conjunto que mais se executa.
 */

import { BlissError } from "@saude-bliss/core";
import { makeCreatePayload, makeEvent, makeListQuery, makeRequest, makeUuid } from "@saude-bliss/testing";
import type { RequestsRepository } from "../../src/repositories/RequestsRepository";
import { RequestsService } from "../../src/services/RequestsService";

function makeRepository(overrides: Partial<jest.Mocked<RequestsRepository>> = {}) {
	return {
		insert: jest.fn(),
		findById: jest.fn(),
		findEventsByRequestId: jest.fn().mockResolvedValue([]),
		list: jest.fn(),
		ping: jest.fn().mockResolvedValue(true),
		...overrides,
	} as unknown as jest.Mocked<RequestsRepository>;
}

describe("RequestsService.create", () => {
	it("delega ao repositório apenas os campos do payload", async () => {
		const created = makeRequest();
		const repository = makeRepository({ insert: jest.fn().mockResolvedValue(created) });
		const payload = makeCreatePayload();

		const result = await new RequestsService(repository).create(payload);

		expect(repository.insert).toHaveBeenCalledWith({
			title: payload.title,
			description: payload.description,
			priority: payload.priority,
			createdBy: payload.createdBy,
		});
		expect(result).toBe(created);
	});

	it("nunca repassa status ao repositório, mesmo se vier no payload", async () => {
		const repository = makeRepository({ insert: jest.fn().mockResolvedValue(makeRequest()) });

		// O schema `.strict()` já barra isso na borda; a asserção aqui garante que
		// o service não reintroduza o campo caso alguém troque a validação.
		await new RequestsService(repository).create({ ...makeCreatePayload(), status: "reviewed" } as never);

		expect(repository.insert).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }));
	});
});

describe("RequestsService.getById", () => {
	it("retorna a solicitação com a linha do tempo de eventos", async () => {
		const request = makeRequest();
		const events = [makeEvent({ requestId: request.id })];
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(request),
			findEventsByRequestId: jest.fn().mockResolvedValue(events),
		});

		const result = await new RequestsService(repository).getById(request.id);

		expect(result).toEqual({ ...request, events });
	});

	it("lança REQUEST_NOT_FOUND quando a solicitação não existe", async () => {
		const repository = makeRepository({ findById: jest.fn().mockResolvedValue(null) });
		const id = makeUuid();

		await expect(new RequestsService(repository).getById(id)).rejects.toMatchObject({
			code: "REQUEST_NOT_FOUND",
			httpStatus: 404,
			details: { id },
		});
	});

	it("não consulta eventos quando a solicitação não existe", async () => {
		const repository = makeRepository({ findById: jest.fn().mockResolvedValue(null) });

		await expect(new RequestsService(repository).getById(makeUuid())).rejects.toBeInstanceOf(BlissError);

		expect(repository.findEventsByRequestId).not.toHaveBeenCalled();
	});
});

describe("RequestsService.list", () => {
	it("calcula a paginação a partir do total do repositório", async () => {
		const repository = makeRepository({
			list: jest.fn().mockResolvedValue({ items: [makeRequest()], total: 42 }),
		});

		const result = await new RequestsService(repository).list(makeListQuery({ page: 2, pageSize: 20 }));

		expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 42, totalPages: 3 });
	});

	it("retorna uma página quando não há resultados", async () => {
		const repository = makeRepository({ list: jest.fn().mockResolvedValue({ items: [], total: 0 }) });

		const result = await new RequestsService(repository).list(makeListQuery());

		// 0 páginas quebra paginador de front; 1 página vazia é o estado correto.
		expect(result.pagination.totalPages).toBe(1);
		expect(result.items).toEqual([]);
	});

	it("repassa os filtros recebidos ao repositório", async () => {
		const repository = makeRepository({ list: jest.fn().mockResolvedValue({ items: [], total: 0 }) });
		const query = makeListQuery({ createdBy: "ana.souza@saudebliss.test", status: ["open"] });

		await new RequestsService(repository).list(query);

		expect(repository.list).toHaveBeenCalledWith(query);
	});
});

describe("RequestsService.checkDatabase", () => {
	it("delega o ping ao repositório", async () => {
		const repository = makeRepository();

		await expect(new RequestsService(repository).checkDatabase()).resolves.toBe(true);
		expect(repository.ping).toHaveBeenCalled();
	});
});

describe("fronteira de domínio", () => {
	it("não expõe operação de conferência — ela pertence ao bliss-reviews", () => {
		// A separação de domínios é estrutural, não convenção: se `review` reaparecer
		// aqui, o serviço de solicitações voltou a poder escrever status.
		expect(new RequestsService(makeRepository())).not.toHaveProperty("review");
	});
});
