/**
 * Regras de domínio da conferência.
 *
 * As transições de status são o coração deste serviço, então cada caminho —
 * feliz, já conferida, transição proibida e corrida entre conferentes — tem
 * teste próprio. O repositório é um duplo: a decisão é o que está sob teste, não
 * o SQL.
 */

import { BlissError } from "@saude-bliss/core";
import { makeEvent, makeRequest, makeReviewPayload, makeUuid } from "@saude-bliss/testing";
import type { ReviewDatabaseService } from "../../src/services/ReviewDatabaseService";
import { ReviewsService } from "../../src/services/ReviewsService";

function makeRepository(overrides: Partial<jest.Mocked<ReviewDatabaseService>> = {}) {
	return {
		findById: jest.fn(),
		findEventsByRequestId: jest.fn().mockResolvedValue([]),
		updateStatus: jest.fn(),
		ping: jest.fn().mockResolvedValue(true),
		...overrides,
	} as unknown as jest.Mocked<ReviewDatabaseService>;
}

describe("ReviewsService.review — caminho feliz", () => {
	it("marca como revisada uma solicitação aberta", async () => {
		const current = makeRequest({ status: "open" });
		const updated = makeRequest({ ...current, status: "reviewed", reviewedBy: "daniel@saudebliss.test" });
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(current),
			updateStatus: jest.fn().mockResolvedValue(updated),
		});

		const result = await new ReviewsService(repository).review(
			current.id,
			makeReviewPayload({ reviewedBy: "daniel@saudebliss.test" })
		);

		expect(repository.updateStatus).toHaveBeenCalledWith(
			expect.objectContaining({ id: current.id, fromStatus: "open", toStatus: "reviewed" })
		);
		expect(result.status).toBe("reviewed");
	});

	it.each([
		["open", "reviewed"],
		["open", "rejected"],
		["in_review", "reviewed"],
		["in_review", "rejected"],
	] as const)("aceita a transição de %s para %s", async (from, to) => {
		const current = makeRequest({ status: from });
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(current),
			updateStatus: jest.fn().mockResolvedValue(makeRequest({ ...current, status: to })),
		});

		const result = await new ReviewsService(repository).review(current.id, makeReviewPayload({ status: to }));

		expect(result.status).toBe(to);
	});

	it("repassa a observação ao repositório", async () => {
		const current = makeRequest({ status: "open" });
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(current),
			updateStatus: jest.fn().mockResolvedValue(makeRequest({ ...current, status: "reviewed" })),
		});

		await new ReviewsService(repository).review(
			current.id,
			makeReviewPayload({ note: "Conferido com a operadora por telefone." })
		);

		expect(repository.updateStatus).toHaveBeenCalledWith(
			expect.objectContaining({ note: "Conferido com a operadora por telefone." })
		);
	});
});

describe("ReviewsService.review — recusas", () => {
	it("lança REQUEST_NOT_FOUND quando a solicitação não existe", async () => {
		const repository = makeRepository({ findById: jest.fn().mockResolvedValue(null) });

		await expect(new ReviewsService(repository).review(makeUuid(), makeReviewPayload())).rejects.toMatchObject({
			code: "REQUEST_NOT_FOUND",
			httpStatus: 404,
		});
	});

	it.each(["reviewed", "rejected"] as const)(
		"lança REQUEST_ALREADY_REVIEWED quando a solicitação já está %s",
		async (status) => {
			const current = makeRequest({ status, reviewedBy: "outro@saudebliss.test" });
			const repository = makeRepository({ findById: jest.fn().mockResolvedValue(current) });

			await expect(new ReviewsService(repository).review(current.id, makeReviewPayload())).rejects.toMatchObject({
				code: "REQUEST_ALREADY_REVIEWED",
				httpStatus: 409,
			});
		}
	);

	it("informa quem já havia conferido, para a mensagem ser acionável", async () => {
		const current = makeRequest({ status: "reviewed", reviewedBy: "ana@saudebliss.test" });
		const repository = makeRepository({ findById: jest.fn().mockResolvedValue(current) });

		await expect(new ReviewsService(repository).review(current.id, makeReviewPayload())).rejects.toMatchObject({
			details: expect.objectContaining({ reviewedBy: "ana@saudebliss.test" }),
		});
	});

	it("não escreve no banco quando a transição é recusada", async () => {
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(makeRequest({ status: "reviewed" })),
		});

		await expect(new ReviewsService(repository).review(makeUuid(), makeReviewPayload())).rejects.toThrow(BlissError);

		expect(repository.updateStatus).not.toHaveBeenCalled();
	});

	it("lança REQUEST_ALREADY_REVIEWED quando outro conferente vence a corrida", async () => {
		// `updateStatus` devolve null quando o compare-and-set não encontra a linha
		// no status esperado — é a corrida entre duas pessoas conferindo a mesma
		// fila, que a checagem prévia sozinha não cobre.
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(makeRequest({ status: "open" })),
			updateStatus: jest.fn().mockResolvedValue(null),
		});

		await expect(new ReviewsService(repository).review(makeUuid(), makeReviewPayload())).rejects.toMatchObject({
			code: "REQUEST_ALREADY_REVIEWED",
		});
	});
});

describe("ReviewsService.getTimeline", () => {
	it("retorna a solicitação com os eventos", async () => {
		const request = makeRequest();
		const events = [makeEvent({ requestId: request.id })];
		const repository = makeRepository({
			findById: jest.fn().mockResolvedValue(request),
			findEventsByRequestId: jest.fn().mockResolvedValue(events),
		});

		const result = await new ReviewsService(repository).getTimeline(request.id);

		expect(result).toEqual({ ...request, events });
	});

	it("lança REQUEST_NOT_FOUND quando a solicitação não existe", async () => {
		const repository = makeRepository({ findById: jest.fn().mockResolvedValue(null) });

		await expect(new ReviewsService(repository).getTimeline(makeUuid())).rejects.toMatchObject({
			code: "REQUEST_NOT_FOUND",
		});
	});
});

describe("ReviewsService.checkDatabase", () => {
	it("delega o ping ao repositório", async () => {
		const repository = makeRepository();

		await expect(new ReviewsService(repository).checkDatabase()).resolves.toBe(true);
		expect(repository.ping).toHaveBeenCalled();
	});
});

describe("fronteira de domínio", () => {
	it("não expõe criação de solicitação — ela pertence ao bliss-requests", () => {
		const service = new ReviewsService(makeRepository());

		expect(service).not.toHaveProperty("create");
		expect(service).not.toHaveProperty("list");
	});
});
