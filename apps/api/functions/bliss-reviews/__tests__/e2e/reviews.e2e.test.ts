/**
 * Conferência contra Postgres real.
 *
 * O teste que justifica esta camada é o de **conferência concorrente**: só com
 * um banco de verdade dá para provar que duas conferências simultâneas da mesma
 * solicitação resultam em uma vencedora e uma recusada, em vez de as duas
 * sobrescreverem. Com repositório mockado, esse comportamento é apenas uma
 * suposição sobre o `where` da query.
 *
 * Requer o Postgres do compose no ar (`pnpm infra:up`). Pule com `SKIP_E2E=1`.
 */

import { runWithRequestContext } from "@saude-bliss/core";
import { closeDb, getDb, requestEvents, requests } from "@saude-bliss/database";
import { eq, like } from "drizzle-orm";
import { ReviewDatabaseService } from "../../src/services/ReviewDatabaseService";
import { ReviewsService } from "../../src/services/ReviewsService";

const describeE2E = process.env.SKIP_E2E === "1" ? describe.skip : describe;

const RUN = `e2e-rev-${process.pid}`;
const actor = (name: string) => `${RUN}.${name}@saudebliss.test`;

const repository = new ReviewDatabaseService();
const service = new ReviewsService(repository);

async function cleanup(): Promise<void> {
	const db = await getDb();
	await db.delete(requests).where(like(requests.createdBy, `${RUN}%`));
}

/** Cria uma solicitação diretamente, sem depender do serviço de solicitações. */
async function seedRequest(status: "open" | "in_review" = "open"): Promise<string> {
	const db = await getDb();
	const [row] = await db
		.insert(requests)
		.values({
			title: "Solicitação para conferência",
			description: "Descrição suficientemente longa para satisfazer a validação de domínio.",
			priority: "high",
			status,
			createdBy: actor("ana"),
			createdTraceId: "trace-seed",
		})
		.returning();
	if (!row) throw new Error("seed não retornou linha");
	return row.id;
}

beforeAll(cleanup);

afterAll(async () => {
	await cleanup();
	await closeDb();
});

describeE2E("ReviewsService.review — persistência", () => {
	it("aplica a conferência e grava reviewedBy e reviewedAt", async () => {
		const id = await seedRequest();

		const updated = await service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" });

		expect(updated).toMatchObject({ status: "reviewed", reviewedBy: actor("daniel") });
		expect(updated.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("registra o evento de conferência com o trace da requisição", async () => {
		const id = await seedRequest();

		await runWithRequestContext({ requestId: "trace-conferencia", startedAt: Date.now() }, () =>
			service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" })
		);

		const db = await getDb();
		const events = await db.select().from(requestEvents).where(eq(requestEvents.requestId, id));

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "reviewed",
			fromStatus: "open",
			toStatus: "reviewed",
			traceId: "trace-conferencia",
		});
	});

	it("aplica a rejeição a partir de in_review", async () => {
		const id = await seedRequest("in_review");

		const updated = await service.review(id, { reviewedBy: actor("daniel"), status: "rejected" });

		expect(updated.status).toBe("rejected");
	});

	it("expõe a linha do tempo com o evento gravado", async () => {
		const id = await seedRequest();
		await service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" });

		const timeline = await service.getTimeline(id);

		expect(timeline.status).toBe("reviewed");
		expect(timeline.events).toHaveLength(1);
	});
});

describeE2E("ReviewsService.review — recusas", () => {
	it("recusa conferir uma solicitação já conferida", async () => {
		const id = await seedRequest();
		await service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" });

		await expect(service.review(id, { reviewedBy: actor("ana"), status: "reviewed" })).rejects.toMatchObject({
			code: "REQUEST_ALREADY_REVIEWED",
		});
	});

	it("não grava um segundo evento na tentativa recusada", async () => {
		const id = await seedRequest();
		await service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" });
		await service.review(id, { reviewedBy: actor("ana"), status: "reviewed" }).catch(() => undefined);

		const db = await getDb();
		const events = await db.select().from(requestEvents).where(eq(requestEvents.requestId, id));

		expect(events).toHaveLength(1);
	});

	it("lança REQUEST_NOT_FOUND para um id inexistente", async () => {
		await expect(
			service.review("00000000-0000-4000-8000-999999999999", { reviewedBy: actor("daniel"), status: "reviewed" })
		).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
	});
});

describeE2E("ReviewsService.review — concorrência", () => {
	it("elege uma única vencedora quando duas conferências disputam a mesma solicitação", async () => {
		const id = await seedRequest();

		// Cenário real: duas pessoas abrem a fila de conferência ao mesmo tempo e
		// clicam na mesma linha. A checagem prévia de status não cobre isso — quem
		// cobre é o compare-and-set no `where` do UPDATE.
		const results = await Promise.allSettled([
			service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" }),
			service.review(id, { reviewedBy: actor("ana"), status: "rejected" }),
		]);

		const cumpridas = results.filter((r) => r.status === "fulfilled");
		const recusadas = results.filter((r) => r.status === "rejected");

		expect(cumpridas).toHaveLength(1);
		expect(recusadas).toHaveLength(1);
		expect((recusadas[0] as PromiseRejectedResult).reason).toMatchObject({
			code: "REQUEST_ALREADY_REVIEWED",
		});
	});

	it("grava exatamente um evento após a disputa", async () => {
		const id = await seedRequest();

		await Promise.allSettled([
			service.review(id, { reviewedBy: actor("daniel"), status: "reviewed" }),
			service.review(id, { reviewedBy: actor("ana"), status: "rejected" }),
		]);

		const db = await getDb();
		const events = await db.select().from(requestEvents).where(eq(requestEvents.requestId, id));

		// Uma escrita perdida aqui significaria trilha de auditoria mentindo sobre
		// quem conferiu — o oposto do propósito da trilha.
		expect(events).toHaveLength(1);
	});
});

describeE2E("ReviewDatabaseService.ping", () => {
	it("confirma conectividade com o banco", async () => {
		await expect(repository.ping()).resolves.toBe(true);
	});
});
