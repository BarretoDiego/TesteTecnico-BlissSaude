/**
 * Conferência diária — o fluxo que a automação substitui.
 *
 * Hoje alguém abre a fila, confere cada solicitação contra o registro e marca
 * como revisada. O teste faz o mesmo, com uma diferença que é o ponto todo:
 * compara **linha a linha** o que a tela mostra com o que a API devolve, e
 * registra cada conferência no CSV.
 *
 * É essa comparação que separa uma conferência de um roteiro de cliques — sem
 * ela o teste passaria com a tela exibindo dado errado.
 */

import { expect, test } from "~/fixtures/test";
import type { ConferenciaRow } from "~/reporters/CsvReporter";

test.describe("conferência diária", () => {
	test("confere cada solicitação comparando a linha da UI com o registro da API", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
		runId,
	}, testInfo) => {
		const seeded = await seedRequests({ count: 3 });
		await conferenciaPage.goto();

		const rows = await conferenciaPage.snapshotRows();
		const divergencias: string[] = [];

		for (const request of seeded) {
			const row = rows.find((candidate) => candidate.id === request.id);
			expect(row, `solicitação ${request.id} deveria estar na fila`).toBeDefined();

			// O oráculo: o estado real vem da API, não de outra leitura da tela.
			const fromApi = await api.getRequest(request.id);

			const divergencia =
				row!.status !== fromApi.status || row!.createdBy !== fromApi.createdBy || row!.priority !== fromApi.priority;

			if (divergencia) divergencias.push(request.id);

			const csvRow: ConferenciaRow = {
				runId,
				requestId: (await conferenciaPage.currentRequestId()) ?? "",
				solicitacaoId: request.id,
				title: fromApi.title,
				createdBy: fromApi.createdBy,
				priority: fromApi.priority,
				statusUI: row!.status,
				statusAPI: fromApi.status,
				divergencia,
				acao: "conferida",
				resultado: divergencia ? "divergente" : "conforme",
			};

			// Anexo, não escrita direta: o reporter grava o CSV mesmo se o teste
			// falhar adiante — que é justamente quando a operação precisa dele.
			await testInfo.attach("conferencia-row", {
				body: JSON.stringify(csvRow),
				contentType: "application/json",
			});
		}

		expect(divergencias, "nenhuma solicitação deveria divergir entre a UI e a API").toEqual([]);
	});

	test("marca como revisada e a solicitação sai da fila", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		await expect(conferenciaPage.rowById(request!.id)).toBeVisible();
		await conferenciaPage.markAsReviewed(request!.id);

		await expect(conferenciaPage.rowById(request!.id)).toHaveCount(0);

		// Confirma no oráculo: a fila esvaziar poderia ser só efeito visual.
		const fromApi = await api.getRequest(request!.id);
		expect(fromApi.status).toBe("reviewed");
		expect(fromApi.reviewedBy).toBe(process.env.AUTOMATION_EMAIL ?? "daniel.morais@saudebliss.test");
	});

	test("cancelar a confirmação não registra a conferência", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		await conferenciaPage.openConfirmationAndCancel(request!.id, "reviewed");

		// A linha continua na fila...
		await expect(conferenciaPage.rowById(request!.id)).toBeVisible();

		// ...e, o que de fato importa, nada foi escrito. Sem consultar o oráculo o
		// teste provaria só que a tela não mudou, não que a API não foi chamada.
		const fromApi = await api.getRequest(request!.id);
		expect(fromApi.status).toBe("open");
		expect(fromApi.reviewedBy).toBeNull();
	});

	test("a conferência é registrada na trilha de auditoria", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();
		await conferenciaPage.markAsReviewed(request!.id);

		const timeline = await api.getTimeline(request!.id);
		const eventos = timeline.events.map((event) => event.type);

		// Criação e conferência: é a trilha que prova quem conferiu o quê e quando.
		expect(eventos).toContain("created");
		expect(eventos).toContain("reviewed");
	});

	test("rejeita uma solicitação e ela deixa a fila com status rejected", async ({
		authenticated,
		conferenciaPage,
		api,
		seedRequests,
	}) => {
		const [request] = await seedRequests({ count: 1 });
		await conferenciaPage.goto();

		await conferenciaPage.markAsRejected(request!.id);

		const fromApi = await api.getRequest(request!.id);
		expect(fromApi.status).toBe("rejected");
	});

	test("o contador da fila diminui a cada conferência", async ({ authenticated, conferenciaPage, seedRequests }) => {
		const seeded = await seedRequests({ count: 2 });
		await conferenciaPage.goto();

		// O total, e não o número de linhas: a fila é paginada, e conferir uma
		// solicitação puxa a próxima pendente para o lugar dela. Contar linhas
		// afirmaria que a página encolhe, que é justamente o que não deve acontecer.
		const antes = await conferenciaPage.pendingTotal();
		await conferenciaPage.markAsReviewed(seeded[0]!.id);

		await expect
			.poll(() => conferenciaPage.pendingTotal(), { message: "o total de pendentes deveria cair em um" })
			.toBe(antes - 1);
	});

	test("a fila pagina e a segunda página traz solicitações diferentes", async ({
		authenticated,
		conferenciaPage,
		seedRequests,
	}) => {
		await seedRequests({ count: 3 });
		await conferenciaPage.goto({ pageSize: 2 });

		const primeira = await conferenciaPage.snapshotRows();
		expect(primeira).toHaveLength(2);

		await conferenciaPage.goto({ pageSize: 2, page: 2 });
		const segunda = await conferenciaPage.snapshotRows();

		// Sem desempate estável na ordenação, uma linha pode aparecer nas duas
		// páginas — defeito que só se manifesta com navegação por páginas.
		const repetidas = segunda.filter((row) => primeira.some((outra) => outra.id === row.id));
		expect(repetidas, "nenhuma solicitação deveria aparecer em duas páginas").toEqual([]);
	});
});
