/**
 * Caminhos do repositório que o Postgres real não alcança.
 *
 * A suíte `e2e` exercita o SQL de verdade e é ela quem prova que as queries
 * fazem o que dizem. Sobram situações que banco de verdade **não produz**: o
 * `.returning()` vazio e a contagem sem linha. As duas são defesas contra
 * `noUncheckedIndexedAccess` — o tipo é `| undefined`, o código trata, e o
 * Postgres nunca devolve isso.
 *
 * Deixá-las sem teste é deixar sem verificação justamente o ramo que só roda no
 * dia em que algo muito errado aconteceu: ninguém percebe se o tratamento
 * regride para um `throw` sem mensagem ou para um `NaN` na paginação.
 *
 * Junto vêm dois casos que o `e2e` não cobre por construção — a listagem sem
 * nenhum filtro e a escrita fora de contexto de requisição —, porque a suíte
 * daquela camada sempre filtra por um `createdBy` próprio e sempre roda dentro
 * de `runWithRequestContext`.
 *
 * O duplo do Drizzle é montado à mão em vez de mockado por módulo: injetar pelo
 * construtor é a razão de `dbPromise` existir, e um duplo explícito documenta
 * qual encadeamento o repositório percorre.
 */

import type { Database } from "@saude-bliss/database";
import { RequestsRepository } from "../../src/repositories/RequestsRepository";

interface DbDouble {
	db: Database;
	/** Valores passados a cada `insert().values(...)`, na ordem. */
	gravados: Record<string, unknown>[];
}

/**
 * Duplo do Drizzle com o encadeamento que `insert` e `list` percorrem.
 *
 * As duas consultas de `list` se distinguem pelo argumento de `select`: a de
 * linhas chama `select()` sem campos e segue por `orderBy/limit/offset`; a de
 * contagem chama `select({ value: count() })` e é aguardada logo após o `where`.
 */
function makeDb(options: { rows?: unknown[]; totals?: unknown[]; inserted?: unknown[] } = {}): DbDouble {
	const { rows = [], totals = [], inserted = [] } = options;
	const gravados: Record<string, unknown>[] = [];

	const tx = {
		insert: () => ({
			values: (valores: Record<string, unknown>) => {
				gravados.push(valores);
				return { returning: () => Promise.resolve(inserted) };
			},
		}),
	};

	const db = {
		transaction: (callback: (t: typeof tx) => unknown) => callback(tx),
		select: (fields?: unknown) =>
			fields === undefined
				? {
						from: () => ({
							where: () => ({
								orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(rows) }) }),
							}),
						}),
					}
				: { from: () => ({ where: () => Promise.resolve(totals) }) },
	} as unknown as Database;

	return { db, gravados };
}

const ENTRADA = {
	title: "Solicitação de teste",
	description: "Descrição suficientemente longa para satisfazer a validação de domínio.",
	priority: "high" as const,
	createdBy: "ana.souza@saudebliss.test",
};

/** Linha que o Postgres devolveria no `.returning()`. */
const LINHA = {
	id: "3f04dd9e-0000-4000-8000-000000000001",
	title: ENTRADA.title,
	description: ENTRADA.description,
	priority: ENTRADA.priority,
	status: "open",
	createdBy: ENTRADA.createdBy,
	createdTraceId: null,
	reviewedBy: null,
	reviewedAt: null,
	createdAt: new Date("2026-08-03T00:00:00.000Z"),
	updatedAt: new Date("2026-08-03T00:00:00.000Z"),
};

describe("RequestsRepository.insert — defesas do contrato do driver", () => {
	it("falha com mensagem explícita quando o insert não devolve linha", async () => {
		const { db } = makeDb({ inserted: [] });

		// Sem esta checagem o código seguiria com `row` indefinido e quebraria duas
		// linhas adiante, no `row.id` do evento de auditoria — erro que aponta para
		// a trilha de auditoria quando o defeito está na solicitação.
		await expect(new RequestsRepository(Promise.resolve(db)).insert(ENTRADA)).rejects.toThrow(/não retornou linha/);
	});

	it("grava traceId nulo quando não há contexto de requisição", async () => {
		const { db, gravados } = makeDb({ inserted: [LINHA] });

		await new RequestsRepository(Promise.resolve(db)).insert(ENTRADA);

		// Chamada fora de `runWithRequestContext` — um job ou script de manutenção.
		// Precisa gravar `null`, e não quebrar nem inventar um id que não
		// corresponde a requisição nenhuma, o que envenenaria a busca por trace.
		expect(gravados[0]).toMatchObject({ createdTraceId: null, status: "open" });
		expect(gravados[1]).toMatchObject({ type: "created", toStatus: "open", traceId: null });
	});
});

describe("RequestsRepository.list — bordas da paginação", () => {
	it("lista sem nenhum filtro", async () => {
		const { db } = makeDb({ rows: [], totals: [{ value: 0 }] });

		// Nenhum filtro informado: o `where` fica `undefined` em vez de um `and()`
		// sem operandos, que o Drizzle não trata como "sem filtro".
		await expect(new RequestsRepository(Promise.resolve(db)).list({ page: 1, pageSize: 20 })).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	it("devolve total zero quando a contagem não traz linha", async () => {
		const { db } = makeDb({ rows: [], totals: [] });

		// `select count()` sempre devolve uma linha no Postgres. O fallback existe
		// para o tipo, e sem ele o total viraria `undefined` — que a paginação da
		// tela de listagem renderizaria como `NaN`.
		await expect(new RequestsRepository(Promise.resolve(db)).list({ page: 1, pageSize: 20 })).resolves.toEqual({
			items: [],
			total: 0,
		});
	});
});
