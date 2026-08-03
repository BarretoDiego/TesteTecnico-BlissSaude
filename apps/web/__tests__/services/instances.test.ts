/**
 * Cliente HTTP do backoffice.
 *
 * Centraliza o que toda chamada faz igual: anexa o token, gera e propaga o
 * `x-request-id`, desembrulha o envelope e converte erro em `ApiError` tipado.
 * É a camada que nenhum componente pode contornar — e é por isso que uma
 * regressão aqui atinge todas as telas de uma vez.
 */

import MockAdapter from "axios-mock-adapter";
import { ApiError, apiClient, getAccessToken, setAccessToken } from "~/services/instances";

const mock = new MockAdapter(apiClient);

const envelopeSucesso = (data: unknown, requestId = "trace-1") => ({
	success: true,
	data,
	requestId,
	timestamp: "2026-08-03T12:00:00.000Z",
});

const envelopeErro = (code: string, message: string, details?: unknown, requestId = "trace-1") => ({
	success: false,
	error: { code, message, ...(details ? { details } : {}) },
	requestId,
	timestamp: "2026-08-03T12:00:00.000Z",
});

beforeEach(() => {
	mock.reset();
	setAccessToken(undefined);
});

afterAll(() => {
	mock.restore();
});

describe("desembrulho do envelope", () => {
	it("entrega apenas o `data` ao chamador", async () => {
		mock.onGet("/requests").reply(200, envelopeSucesso({ items: [], total: 0 }));

		const { data } = await apiClient.get("/requests");

		// Sem isto todo chamador escreveria `response.data.data`, e o envelope
		// vazaria para dentro dos componentes.
		expect(data).toEqual({ items: [], total: 0 });
	});

	it("preserva resposta que não vem em envelope", async () => {
		// Nem tudo que o cliente alcança é a nossa API — um proxy pode responder
		// direto, e engolir isso deixaria o chamador sem o corpo.
		mock.onGet("/externo").reply(200, { qualquer: "coisa" });

		const { data } = await apiClient.get("/externo");

		expect(data).toEqual({ qualquer: "coisa" });
	});

	it("desembrulha `data` nulo sem confundir com ausência", async () => {
		mock.onGet("/vazio").reply(200, envelopeSucesso(null));

		await expect(apiClient.get("/vazio")).resolves.toMatchObject({ data: null });
	});
});

describe("propagação do requestId", () => {
	it("gera um id e o envia no header", async () => {
		let enviado: string | undefined;
		mock.onGet("/requests").reply((config) => {
			enviado = config.headers?.["x-request-id"] as string;
			return [200, envelopeSucesso([])];
		});

		await apiClient.get("/requests");

		// O trace começa no browser — é isso que permite correlacionar do clique
		// até a linha de log no CloudWatch.
		expect(enviado).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("gera ids distintos por requisição", async () => {
		const ids: string[] = [];
		mock.onGet("/requests").reply((config) => {
			ids.push(config.headers?.["x-request-id"] as string);
			return [200, envelopeSucesso([])];
		});

		await Promise.all([apiClient.get("/requests"), apiClient.get("/requests"), apiClient.get("/requests")]);

		expect(new Set(ids).size).toBe(3);
	});
});

describe("token de acesso", () => {
	it("anexa o Authorization quando há sessão", async () => {
		let header: string | undefined;
		mock.onGet("/auth/me").reply((config) => {
			header = config.headers?.Authorization as string;
			return [200, envelopeSucesso({ id: "1" })];
		});

		setAccessToken("meu-token");
		await apiClient.get("/auth/me");

		expect(header).toBe("Bearer meu-token");
	});

	it("não anexa nada quando não há sessão", async () => {
		let header: string | undefined;
		mock.onGet("/requests").reply((config) => {
			header = config.headers?.Authorization as string | undefined;
			return [200, envelopeSucesso([])];
		});

		await apiClient.get("/requests");

		expect(header).toBeUndefined();
	});

	it("guarda o token em memória, e não em localStorage", () => {
		setAccessToken("token-secreto");

		// É o que reduz a janela de um XSS: script injetado não lê um closure.
		expect(getAccessToken()).toBe("token-secreto");
		expect(localStorage.getItem("token-secreto")).toBeNull();
		expect(JSON.stringify(localStorage)).not.toContain("token-secreto");
	});

	it("limpa o token quando recebe undefined", () => {
		setAccessToken("token");
		setAccessToken(undefined);

		expect(getAccessToken()).toBeUndefined();
	});
});

describe("conversão de erro", () => {
	it("converte o envelope de erro em ApiError tipado", async () => {
		mock.onGet("/requests/x").reply(404, envelopeErro("REQUEST_NOT_FOUND", "Solicitação não encontrada"));

		const erro = await apiClient.get("/requests/x").catch((e: unknown) => e);

		expect(erro).toBeInstanceOf(ApiError);
		expect(erro as ApiError).toMatchObject({
			code: "REQUEST_NOT_FOUND",
			message: "Solicitação não encontrada",
			status: 404,
			requestId: "trace-1",
		});
	});

	it("preserva os detalhes de validação", async () => {
		const detalhes = [{ field: "title", message: "Título muito curto" }];
		mock.onPost("/requests").reply(400, envelopeErro("VALIDATION_ERROR", "Payload inválido", detalhes));

		const erro = (await apiClient.post("/requests", {}).catch((e: unknown) => e)) as ApiError;

		// São eles que o formulário usa para marcar o campo certo.
		expect(erro.details).toEqual(detalhes);
	});

	it("expõe o requestId do erro para correlação", async () => {
		mock.onGet("/x").reply(500, envelopeErro("INTERNAL_ERROR", "Erro interno", undefined, "trace-do-erro"));

		const erro = (await apiClient.get("/x").catch((e: unknown) => e)) as ApiError;

		expect(erro.requestId).toBe("trace-do-erro");
	});

	it("reconhece falta de autenticação", async () => {
		mock.onGet("/auth/me").reply(401, envelopeErro("INVALID_CREDENTIALS", "Token inválido"));

		const erro = (await apiClient.get("/auth/me").catch((e: unknown) => e)) as ApiError;

		expect(erro.isUnauthenticated).toBe(true);
	});

	it("não marca outros status como falta de autenticação", async () => {
		mock.onGet("/x").reply(403, envelopeErro("USER_INACTIVE", "Conta desativada"));

		const erro = (await apiClient.get("/x").catch((e: unknown) => e)) as ApiError;

		expect(erro.isUnauthenticated).toBe(false);
	});

	it("limpa o token em 401", async () => {
		setAccessToken("token-expirado");
		mock.onGet("/auth/me").reply(401, envelopeErro("INVALID_CREDENTIALS", "Token inválido"));

		await apiClient.get("/auth/me").catch(() => undefined);

		// Sem isso o usuário ficaria num limbo: a sessão local diz que está
		// logado, e toda chamada volta 401.
		expect(getAccessToken()).toBeUndefined();
	});

	it("não limpa o token em erro que não seja 401", async () => {
		setAccessToken("token-valido");
		mock.onGet("/x").reply(500, envelopeErro("INTERNAL_ERROR", "Erro interno"));

		await apiClient.get("/x").catch(() => undefined);

		expect(getAccessToken()).toBe("token-valido");
	});

	it("converte falha de rede em erro com código próprio", async () => {
		mock.onGet("/requests").networkError();

		const erro = (await apiClient.get("/requests").catch((e: unknown) => e)) as ApiError;

		// Sem envelope, a falha aconteceu antes da aplicação. O nome do cliente na
		// mensagem é o que permite localizar qual integração caiu.
		expect(erro.code).toBe("NETWORK_ERROR");
		expect(erro.message).toContain("Saúde Bliss");
	});

	it("converte timeout em erro com código próprio", async () => {
		mock.onGet("/lento").timeout();

		const erro = (await apiClient.get("/lento").catch((e: unknown) => e)) as ApiError;

		expect(erro.code).toBe("NETWORK_ERROR");
	});

	it("trata resposta de erro sem envelope como falha de rede", async () => {
		// Acontece quando o API Gateway responde antes da Lambda — 502, 504.
		mock.onGet("/x").reply(502, "<html>Bad Gateway</html>");

		const erro = (await apiClient.get("/x").catch((e: unknown) => e)) as ApiError;

		expect(erro.code).toBe("NETWORK_ERROR");
		expect(erro.status).toBe(502);
	});
});

describe("ApiError", () => {
	it("é um Error de verdade", () => {
		const erro = new ApiError("X", "mensagem", 500);

		// Precisa atravessar `catch` e `instanceof` como qualquer erro, senão
		// tratamento genérico deixaria de funcionar.
		expect(erro).toBeInstanceOf(Error);
		expect(erro.name).toBe("ApiError");
		expect(erro.message).toBe("mensagem");
	});

	it("aceita requestId e detalhes opcionais", () => {
		const erro = new ApiError("X", "m", 400);

		expect(erro.requestId).toBeUndefined();
		expect(erro.details).toBeUndefined();
	});
});

describe("origem da API", () => {
	it("usa a variável pública configurada", () => {
		expect(apiClient.defaults.baseURL).toBe("http://api.teste/v1");
	});

	it("tem timeout definido", () => {
		// Sem timeout, uma Lambda em cold start deixaria a tela girando para sempre.
		expect(apiClient.defaults.timeout).toBeGreaterThan(0);
	});
});
