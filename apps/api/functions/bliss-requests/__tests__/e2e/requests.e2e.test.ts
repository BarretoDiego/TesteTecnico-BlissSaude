/**
 * Ciclo de vida completo contra Postgres real.
 *
 * Esta é a única camada que exercita o SQL de verdade. Vale por duas coisas que
 * teste com mock não consegue provar: que a **transação** de criação grava
 * solicitação e evento juntas, e que os filtros combinados produzem o conjunto
 * certo — que é o requisito do desafio.
 *
 * Requer o Postgres do compose no ar (`pnpm infra:up`) com as migrations
 * aplicadas. Pule com `SKIP_E2E=1`.
 */

import { runWithRequestContext } from "@saude-bliss/core";
import { closeDb, getDb, requestEvents, requests } from "@saude-bliss/database";
import { eq, like } from "drizzle-orm";
import { RequestsRepository } from "../../src/repositories/RequestsRepository";

const describeE2E = process.env.SKIP_E2E === "1" ? describe.skip : describe;

/**
 * Marca própria por execução, para que a suíte limpe só o que criou e possa
 * rodar contra um banco que já tem o seed sem interferir nele.
 */
const RUN = `e2e-${process.pid}`;
const actor = (name: string) => `${RUN}.${name}@saudebliss.test`;

const repository = new RequestsRepository();

async function cleanup(): Promise<void> {
	const db = await getDb();
	// `request_events` cai junto pelo ON DELETE CASCADE da FK.
	await db.delete(requests).where(like(requests.createdBy, `${RUN}%`));
}

beforeAll(cleanup);

afterAll(async () => {
	await cleanup();
	await closeDb();
});

function insert(overrides: Partial<Parameters<RequestsRepository["insert"]>[0]> = {}, traceId = "trace-e2e") {
	return runWithRequestContext({ requestId: traceId, startedAt: Date.now() }, () =>
		repository.insert({
			title: "Solicitação de teste e2e",
			description: "Descrição suficientemente longa para satisfazer a validação de domínio.",
			priority: "high",
			createdBy: actor("ana"),
			...overrides,
		})
	);
}

describeE2E("RequestsRepository.insert", () => {
	it("persiste a solicitação com status open e os campos informados", async () => {
		const created = await insert({ priority: "critical" });

		expect(created).toMatchObject({
			status: "open",
			priority: "critical",
			createdBy: actor("ana"),
			reviewedBy: null,
			reviewedAt: null,
		});
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("grava o requestId do contexto na coluna de trace", async () => {
		const created = await insert({}, "trace-persistido-e2e");

		// É o elo que liga a linha do banco às linhas de log no CloudWatch.
		expect(created.createdTraceId).toBe("trace-persistido-e2e");
	});

	it("registra o evento de criação na mesma transação", async () => {
		const created = await insert();

		const db = await getDb();
		const events = await db.select().from(requestEvents).where(eq(requestEvents.requestId, created.id));

		// Sem a transação, uma falha entre os dois inserts deixaria a solicitação
		// sem trilha — e a tela de conferência depende de encontrá-la.
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: "created", fromStatus: null, toStatus: "open" });
	});

	it("devolve datas como string ISO, não como objeto Date", async () => {
		const created = await insert();

		// A conversão acontece no limite da persistência para que nenhuma camada
		// acima precise saber que o driver devolve `Date`.
		expect(typeof created.createdAt).toBe("string");
		expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
	});
});

describeE2E("RequestsRepository.findById", () => {
	it("encontra a solicitação recém-criada", async () => {
		const created = await insert();

		await expect(repository.findById(created.id)).resolves.toMatchObject({ id: created.id });
	});

	it("devolve null para um id inexistente", async () => {
		await expect(repository.findById("00000000-0000-4000-8000-999999999999")).resolves.toBeNull();
	});
});

describeE2E("RequestsRepository.list — filtros do desafio", () => {
	beforeAll(async () => {
		await cleanup();
		await insert({ createdBy: actor("ana"), priority: "high" });
		await insert({ createdBy: actor("ana"), priority: "low" });
		await insert({ createdBy: actor("bruno"), priority: "high" });
	});

	it("lista tudo do solicitante quando filtra por createdBy", async () => {
		const result = await repository.list({ createdBy: actor("ana"), page: 1, pageSize: 20 });

		expect(result.total).toBe(2);
		expect(result.items.every((item) => item.createdBy === actor("ana"))).toBe(true);
	});

	it("filtra por status", async () => {
		// Lista de um elemento: o filtro virou `in`, e `?status=open` normaliza para cá.
		const result = await repository.list({ status: ["open"], createdBy: actor("bruno"), page: 1, pageSize: 20 });

		expect(result.total).toBe(1);
	});

	it("filtra por vários status de uma vez", async () => {
		// É o que sustenta a fila de conferência: `open` e `in_review` numa consulta
		// paginada só, em vez de duas listagens concatenadas e um total somado.
		const result = await repository.list({ status: ["open", "in_review"], page: 1, pageSize: 20 });

		expect(result.total).toBeGreaterThanOrEqual(1);
		expect(result.items.every((item) => item.status === "open" || item.status === "in_review")).toBe(true);
	});

	it("combina createdBy e priority", async () => {
		const result = await repository.list({ createdBy: actor("ana"), priority: "low", page: 1, pageSize: 20 });

		expect(result.total).toBe(1);
		expect(result.items[0]).toMatchObject({ priority: "low" });
	});

	it("devolve conjunto vazio quando o filtro não casa com nada", async () => {
		const result = await repository.list({ createdBy: actor("ninguem"), page: 1, pageSize: 20 });

		expect(result).toEqual({ items: [], total: 0 });
	});

	it("ordena da mais recente para a mais antiga", async () => {
		const result = await repository.list({ createdBy: actor("ana"), page: 1, pageSize: 20 });

		const timestamps = result.items.map((item) => Date.parse(item.createdAt));
		expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
	});

	it("pagina mantendo o total do conjunto completo", async () => {
		const first = await repository.list({ createdBy: actor("ana"), page: 1, pageSize: 1 });
		const second = await repository.list({ createdBy: actor("ana"), page: 2, pageSize: 1 });

		// `total` é do conjunto filtrado inteiro, não da página — é o que o
		// paginador do backoffice usa para calcular quantas páginas existem.
		expect(first.total).toBe(2);
		expect(second.total).toBe(2);
		expect(first.items).toHaveLength(1);
		expect(first.items[0]!.id).not.toBe(second.items[0]!.id);
	});
});

describeE2E("RequestsRepository.findEventsByRequestId", () => {
	it("devolve a linha do tempo da solicitação", async () => {
		const created = await insert();

		const events = await repository.findEventsByRequestId(created.id);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ requestId: created.id, type: "created" });
	});

	it("devolve lista vazia para um id sem eventos", async () => {
		await expect(repository.findEventsByRequestId("00000000-0000-4000-8000-999999999999")).resolves.toEqual([]);
	});
});

describeE2E("RequestsRepository.ping", () => {
	it("confirma conectividade com o banco", async () => {
		await expect(repository.ping()).resolves.toBe(true);
	});
});
