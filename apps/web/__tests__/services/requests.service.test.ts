/**
 * Serviços de domínio do backoffice.
 *
 * São finos de propósito — a regra vive na API —, mas o que fazem é o contrato
 * de URL e de query. Um caminho errado aqui falha em runtime, num lugar que o
 * TypeScript não alcança.
 */

import MockAdapter from "axios-mock-adapter";
import { HealthService, SERVICE_PROBES } from "~/services/health.service";
import { apiClient } from "~/services/instances";
import { RequestsService } from "~/services/requests.service";

const mock = new MockAdapter(apiClient);

const envelope = (data: unknown) => ({
	success: true,
	data,
	requestId: "trace-1",
	timestamp: "2026-08-03T12:00:00.000Z",
});

const solicitacao = {
	id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
	title: "Título",
	description: "Descrição suficientemente longa.",
	priority: "high",
	status: "open",
	createdBy: "ana@saudebliss.test",
	reviewedBy: null,
	reviewedAt: null,
	createdTraceId: "trace-1",
	createdAt: "2026-08-03T12:00:00.000Z",
	updatedAt: "2026-08-03T12:00:00.000Z",
};

beforeEach(() => mock.reset());
afterAll(() => mock.restore());

describe("RequestsService.list", () => {
	it("consulta /requests sem parâmetros por padrão", async () => {
		mock
			.onGet("/requests")
			.reply(200, envelope({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }));

		await RequestsService.list();

		expect(mock.history.get[0]!.url).toBe("/requests");
	});

	it("repassa os filtros como query string", async () => {
		mock.onGet("/requests").reply(200, envelope({ items: [], pagination: {} }));

		await RequestsService.list({ status: "open,in_review", createdBy: "ana@x.test", page: 2, pageSize: 10 });

		expect(mock.history.get[0]!.params).toEqual({
			status: "open,in_review",
			createdBy: "ana@x.test",
			page: 2,
			pageSize: 10,
		});
	});

	it("devolve itens e paginação já desembrulhados", async () => {
		const resultado = { items: [solicitacao], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };
		mock.onGet("/requests").reply(200, envelope(resultado));

		await expect(RequestsService.list()).resolves.toEqual(resultado);
	});

	it("propaga o erro da API", async () => {
		mock.onGet("/requests").reply(503, {
			success: false,
			error: { code: "DATABASE_UNAVAILABLE", message: "Banco fora" },
			requestId: "t",
			timestamp: "2026-08-03T12:00:00.000Z",
		});

		await expect(RequestsService.list()).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
	});
});

describe("RequestsService.getById", () => {
	it("monta o caminho com o id", async () => {
		mock.onGet(`/requests/${solicitacao.id}`).reply(200, envelope({ ...solicitacao, events: [] }));

		await RequestsService.getById(solicitacao.id);

		expect(mock.history.get[0]!.url).toBe(`/requests/${solicitacao.id}`);
	});

	it("devolve a solicitação com a trilha", async () => {
		mock.onGet(`/requests/${solicitacao.id}`).reply(200, envelope({ ...solicitacao, events: [{ id: "e1" }] }));

		const detalhe = await RequestsService.getById(solicitacao.id);

		expect(detalhe.events).toHaveLength(1);
	});
});

describe("RequestsService.create", () => {
	it("envia o payload em POST", async () => {
		const payload = {
			title: "Nova",
			description: "Descrição suficientemente longa.",
			priority: "high" as const,
			createdBy: "ana@x.test",
		};
		mock.onPost("/requests").reply(201, envelope(solicitacao));

		await RequestsService.create(payload);

		expect(JSON.parse(mock.history.post[0]!.data)).toEqual(payload);
	});

	it("devolve a solicitação criada", async () => {
		mock.onPost("/requests").reply(201, envelope(solicitacao));

		await expect(
			RequestsService.create({
				title: "x",
				description: "y",
				priority: "low",
				createdBy: "a@b.test",
			})
		).resolves.toMatchObject({ id: solicitacao.id });
	});
});

describe("RequestsService.review", () => {
	it("usa PATCH no microserviço de conferência, e não no de solicitações", async () => {
		mock.onPatch(`/reviews/${solicitacao.id}`).reply(200, envelope({ ...solicitacao, status: "reviewed" }));

		await RequestsService.review(solicitacao.id, { reviewedBy: "daniel@x.test", status: "reviewed" });

		// Outro prefixo, outro domínio: escrever status pertence a `bliss-reviews`.
		expect(mock.history.patch[0]!.url).toBe(`/reviews/${solicitacao.id}`);
	});

	it("envia quem conferiu e o desfecho", async () => {
		mock.onPatch(`/reviews/${solicitacao.id}`).reply(200, envelope(solicitacao));

		await RequestsService.review(solicitacao.id, { reviewedBy: "daniel@x.test", status: "rejected" });

		expect(JSON.parse(mock.history.patch[0]!.data)).toEqual({ reviewedBy: "daniel@x.test", status: "rejected" });
	});

	it("propaga o 409 de conferência concorrente", async () => {
		mock.onPatch(`/reviews/${solicitacao.id}`).reply(409, {
			success: false,
			error: { code: "REQUEST_ALREADY_REVIEWED", message: "Já conferida" },
			requestId: "t",
			timestamp: "2026-08-03T12:00:00.000Z",
		});

		await expect(
			RequestsService.review(solicitacao.id, { reviewedBy: "d@x.test", status: "reviewed" })
		).rejects.toMatchObject({ code: "REQUEST_ALREADY_REVIEWED", status: 409 });
	});
});

describe("RequestsService.timeline", () => {
	it("consulta a trilha no microserviço de conferência", async () => {
		mock.onGet(`/reviews/${solicitacao.id}/timeline`).reply(200, envelope({ ...solicitacao, events: [] }));

		await RequestsService.timeline(solicitacao.id);

		expect(mock.history.get[0]!.url).toBe(`/reviews/${solicitacao.id}/timeline`);
	});
});

describe("HealthService", () => {
	it("declara uma sonda por microserviço", () => {
		expect(SERVICE_PROBES.map((p) => p.name).sort()).toEqual(["bliss-auth", "bliss-requests", "bliss-reviews"]);
	});

	it("aponta cada sonda para o /health do próprio domínio", () => {
		for (const probe of SERVICE_PROBES) {
			expect(probe.path).toMatch(/^\/\w+\/health$/);
		}
	});

	it("devolve os dados quando o serviço responde", async () => {
		const saude = {
			service: "bliss-requests",
			status: "ok",
			env: "local",
			dependencies: "up",
			uptimeSeconds: 1,
			version: "1.0.0",
		};
		mock.onGet("/requests/health").reply(200, envelope(saude));

		const resultado = await HealthService.probe({ name: "bliss-requests", path: "/requests/health" });

		expect(resultado).toMatchObject({ service: "bliss-requests", reachable: true, data: saude });
		expect(resultado.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("não lança quando o serviço está fora — devolve o resultado", async () => {
		mock.onGet("/requests/health").reply(503, {
			success: false,
			error: { code: "DATABASE_UNAVAILABLE", message: "Dependência indisponível" },
			requestId: "trace-x",
			timestamp: "2026-08-03T12:00:00.000Z",
		});

		const resultado = await HealthService.probe({ name: "bliss-requests", path: "/requests/health" });

		// Serviço fora não é erro da tela: é exatamente a informação que ela existe
		// para mostrar. Lançar aqui esvaziaria a página inteira.
		expect(resultado).toMatchObject({ reachable: false, data: null, error: "Dependência indisponível" });
		expect(resultado.requestId).toBe("trace-x");
	});

	it("trata falha de rede como serviço inalcançável", async () => {
		mock.onGet("/requests/health").networkError();

		const resultado = await HealthService.probe({ name: "bliss-requests", path: "/requests/health" });

		expect(resultado.reachable).toBe(false);
		expect(resultado.error).toBeTruthy();
	});

	it("degrada com mensagem genérica quando a falha não é ApiError", async () => {
		// O interceptor converte tudo que vem da rede em `ApiError`. Um erro que
		// escape dele — uma exceção no próprio interceptor, uma API do browser
		// ausente — chegaria ao `catch` sem `code`, `message` de negócio nem
		// `requestId`. Sem os fallbacks a tela de status renderizaria `undefined`
		// no lugar do motivo, que é a única informação que ela tem a dar.
		jest.spyOn(apiClient, "get").mockRejectedValue(new TypeError("crypto.randomUUID is not a function"));

		const resultado = await HealthService.probe({ name: "bliss-requests", path: "/requests/health" });

		expect(resultado).toMatchObject({ reachable: false, data: null, error: "Falha de comunicação" });
		expect(resultado.requestId).toBeUndefined();
	});

	it("consulta todos os serviços e devolve um resultado por sonda", async () => {
		mock.onGet(/\/health$/).reply(200, envelope({ status: "ok" }));

		const resultados = await HealthService.probeAll();

		expect(resultados).toHaveLength(SERVICE_PROBES.length);
		expect(resultados.map((r) => r.service).sort()).toEqual(SERVICE_PROBES.map((p) => p.name).sort());
	});

	it("um serviço fora não impede os demais de reportarem", async () => {
		mock.onGet("/requests/health").networkError();
		mock.onGet(/\/health$/).reply(200, envelope({ status: "ok" }));

		const resultados = await HealthService.probeAll();

		expect(resultados.filter((r) => r.reachable)).toHaveLength(SERVICE_PROBES.length - 1);
		expect(resultados.filter((r) => !r.reachable)).toHaveLength(1);
	});
});
