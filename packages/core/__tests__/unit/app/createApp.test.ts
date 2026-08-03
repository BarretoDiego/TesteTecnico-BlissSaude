/**
 * Fábrica de aplicação dos microserviços.
 *
 * É o runtime compartilhado: uma regressão aqui atinge os quatro serviços de uma
 * vez, e nenhuma suíte de serviço a pegaria isoladamente. O foco são os
 * comportamentos de plataforma — prefixo, contexto de requisição, CORS, envelope
 * de erro e rota não encontrada — que cada serviço herda sem declarar.
 */

import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../../src/app/createApp";
import { defineService, serviceTag } from "../../../src/app/defineService";
import { describeRoutes, type DomainRouter } from "../../../src/app/router";
import { blissSuccess } from "../../../src/utils/responseEnvelope";

/** Router mínimo com uma rota que ecoa o que a plataforma injetou. */
const rotasDeTeste: DomainRouter = async (app, options) => {
	app.get("/eco", async (req, reply) => blissSuccess(reply, req, { data: { prefixo: options.prefix } }));
	app.post("/eco", async (req, reply) => blissSuccess(reply, req, { data: req.body }));
	app.get("/explode", async () => {
		throw new Error("falha proposital");
	});
	describeRoutes(app, options, [
		{ method: "GET", path: "/eco" },
		{ method: "POST", path: "/eco" },
	]);
};

const servico = defineService({
	name: "bliss-teste",
	description: "Serviço de teste do runtime compartilhado",
	routePrefix: "/teste",
	router: rotasDeTeste,
});

let app: FastifyInstance;

beforeAll(async () => {
	app = await createApp(servico);
	await app.ready();
});

afterAll(async () => {
	await app.close();
});

describe("montagem sob o prefixo", () => {
	it("monta as rotas sob versão + domínio", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/teste/eco" });

		expect(response.statusCode).toBe(200);
	});

	it("informa o prefixo completo ao router", async () => {
		// O router recebe o prefixo como parâmetro, e não só via `register`: é o
		// que permite ao arquivo de rotas conhecer o caminho que expõe.
		const response = await app.inject({ method: "GET", url: "/v1/teste/eco" });

		expect(response.json().data.prefixo).toBe("/v1/teste");
	});

	it("não responde fora do prefixo do domínio", async () => {
		// Cada Lambda é dona de um prefixo. Responder fora dele significaria duas
		// funções disputando a mesma rota no API Gateway.
		const response = await app.inject({ method: "GET", url: "/eco" });

		expect(response.statusCode).toBe(404);
	});

	it("expõe o /health sob o mesmo prefixo", async () => {
		// `/v1/teste/health` e não `/health`: sem colisão quando os serviços sobem
		// juntos, e sem regra extra no API Gateway.
		const response = await app.inject({ method: "GET", url: "/v1/teste/health" });

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toMatchObject({ service: "bliss-teste", status: "ok" });
	});

	it("tolera barra no fim do caminho", async () => {
		// `ignoreTrailingSlash`: o API Gateway às vezes acrescenta a barra, e uma
		// 404 por causa dela seria opaca de diagnosticar.
		const response = await app.inject({ method: "GET", url: "/v1/teste/eco/" });

		expect(response.statusCode).toBe(200);
	});
});

describe("contexto de requisição", () => {
	it("devolve o requestId enviado pelo cliente", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/teste/eco",
			headers: { [REQUEST_ID_HEADER]: "trace-do-cliente" },
		});

		expect(response.json().requestId).toBe("trace-do-cliente");
		expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-do-cliente");
	});

	it("gera um id quando o cliente não envia", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/teste/eco" });

		expect(response.json().requestId).toEqual(expect.any(String));
		expect(response.json().requestId).not.toHaveLength(0);
	});

	it("usa o mesmo id no header e no envelope", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/teste/eco" });

		expect(response.headers[REQUEST_ID_HEADER]).toBe(response.json().requestId);
	});

	it("devolve o header mesmo em rota inexistente", async () => {
		// O header é escrito no `onRequest`, antes de qualquer roteamento — é o que
		// garante correlação inclusive nas respostas emitidas cedo.
		const response = await app.inject({
			method: "GET",
			url: "/v1/teste/nao-existe",
			headers: { [REQUEST_ID_HEADER]: "trace-404" },
		});

		expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-404");
	});

	it("isola o contexto entre requisições concorrentes", async () => {
		// Container reutilizado é o cenário real em Lambda. Vazamento de contexto
		// aqui carimbaria logs com o `requestId` da invocação anterior.
		const [a, b] = await Promise.all([
			app.inject({ method: "GET", url: "/v1/teste/eco", headers: { [REQUEST_ID_HEADER]: "trace-a" } }),
			app.inject({ method: "GET", url: "/v1/teste/eco", headers: { [REQUEST_ID_HEADER]: "trace-b" } }),
		]);

		expect(a.json().requestId).toBe("trace-a");
		expect(b.json().requestId).toBe("trace-b");
	});
});

describe("rota não encontrada", () => {
	it("responde 404 com envelope de erro", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/teste/inexistente" });

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({ success: false, error: { code: "REQUEST_NOT_FOUND" } });
	});

	it("informa método e caminho nos detalhes", async () => {
		// Sem isso o 404 não distingue "rota errada" de "id inexistente" — dois
		// problemas com causas completamente diferentes.
		const response = await app.inject({ method: "DELETE", url: "/v1/teste/inexistente" });

		expect(response.json().error.details).toEqual({ method: "DELETE", url: "/v1/teste/inexistente" });
	});

	it("responde 404 para método não declarado numa rota existente", async () => {
		const response = await app.inject({ method: "DELETE", url: "/v1/teste/eco" });

		expect(response.statusCode).toBe(404);
	});
});

describe("tratamento de erro não capturado", () => {
	it("converte exceção do handler em 500 com envelope", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/teste/explode" });

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
	});

	it("não vaza a mensagem original da exceção", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/teste/explode" });

		// Mensagem interna pode conter credencial, caminho de arquivo ou estrutura
		// do sistema. O `requestId` é o elo com o log, onde o detalhe fica.
		expect(response.body).not.toContain("falha proposital");
		expect(response.json().requestId).toBeTruthy();
	});

	it("mantém o requestId no envelope de 500", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/teste/explode",
			headers: { [REQUEST_ID_HEADER]: "trace-do-500" },
		});

		expect(response.json().requestId).toBe("trace-do-500");
	});
});

describe("CORS", () => {
	it("responde ao preflight", async () => {
		const response = await app.inject({
			method: "OPTIONS",
			url: "/v1/teste/eco",
			headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
		});

		// Quem responde preflight é a aplicação, não o API Gateway — sob
		// `AWS_PROXY` os headers fixos do gateway são ignorados.
		expect(response.statusCode).toBeLessThan(300);
		expect(response.headers["access-control-allow-origin"]).toBeTruthy();
	});

	it("permite o header de correlação na requisição", async () => {
		const response = await app.inject({
			method: "OPTIONS",
			url: "/v1/teste/eco",
			headers: {
				origin: "http://localhost:3000",
				"access-control-request-method": "GET",
				"access-control-request-headers": REQUEST_ID_HEADER,
			},
		});

		// Sem isto o browser reprova o preflight de **toda** chamada, já que o
		// interceptor sempre envia `x-request-id`.
		expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain(REQUEST_ID_HEADER);
	});

	it("expõe o header de correlação na resposta", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/teste/eco",
			headers: { origin: "http://localhost:3000" },
		});

		// Sem `exposedHeaders` o browser esconde o header do JavaScript, e o
		// cliente perderia o trace nas respostas que não trazem envelope.
		expect(String(response.headers["access-control-expose-headers"]).toLowerCase()).toContain(REQUEST_ID_HEADER);
	});
});

describe("corpo da requisição", () => {
	it("desserializa JSON no POST", async () => {
		const response = await app.inject({ method: "POST", url: "/v1/teste/eco", payload: { a: 1 } });

		expect(response.json().data).toEqual({ a: 1 });
	});

	it("responde 400 para JSON malformado", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/teste/eco",
			headers: { "content-type": "application/json" },
			payload: "{ isto não é json",
		});

		expect(response.statusCode).toBe(400);
		expect(response.json().success).toBe(false);
	});
});

describe("defineService", () => {
	it("devolve a definição sem alterá-la", () => {
		expect(defineService(servico)).toBe(servico);
	});

	it("deriva a tag do prefixo quando não informada", () => {
		expect(serviceTag(servico)).toBe("teste");
	});

	it("respeita a tag explícita", () => {
		expect(serviceTag({ ...servico, tag: "personalizada" })).toBe("personalizada");
	});

	it("remove apenas a barra inicial ao derivar", () => {
		expect(serviceTag({ ...servico, routePrefix: "/reviews" })).toBe("reviews");
	});
});
