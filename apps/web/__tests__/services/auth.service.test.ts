/**
 * Serviço de autenticação do backoffice.
 *
 * Fino, mas com dois comportamentos que não são óbvios e importam: o access
 * token entra em memória como efeito de `login`/`refresh`, e o `logout` **não**
 * propaga falha. Testar isso aqui é o que impede que uma refatoração os remova
 * sem ninguém notar.
 */

import MockAdapter from "axios-mock-adapter";
import { AuthService } from "~/services/auth.service";
import { apiClient, getAccessToken, setAccessToken } from "~/services/instances";

const mock = new MockAdapter(apiClient);

const USUARIO = {
	id: "161847b0-900d-4569-80a1-0fc6aac59e1a",
	email: "daniel@saudebliss.test",
	name: "Daniel Morais",
	roles: ["admin"],
};

const sessao = (accessToken = "jwt-novo") => ({
	accessToken,
	expiresIn: 900,
	tokenType: "Bearer",
	refreshToken: "refresh-token-com-tamanho-suficiente",
	user: USUARIO,
});

const envelope = (data: unknown) => ({
	success: true,
	data,
	requestId: "trace-1",
	timestamp: "2026-08-03T12:00:00.000Z",
});

const envelopeErro = (code: string, message: string, status = 401) => [
	status,
	{ success: false, error: { code, message }, requestId: "trace-1", timestamp: "2026-08-03T12:00:00.000Z" },
];

beforeEach(() => {
	mock.reset();
	setAccessToken(undefined);
});

afterAll(() => mock.restore());

describe("AuthService.login", () => {
	it("envia credenciais para /auth/login", async () => {
		mock.onPost("/auth/login").reply(200, envelope(sessao()));

		await AuthService.login({ email: "daniel@saudebliss.test", password: "saudebliss123" });

		expect(mock.history.post[0]!.url).toBe("/auth/login");
		expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
			email: "daniel@saudebliss.test",
			password: "saudebliss123",
		});
	});

	it("guarda o access token em memória como efeito", async () => {
		mock.onPost("/auth/login").reply(200, envelope(sessao("jwt-do-login")));

		await AuthService.login({ email: "d@x.test", password: "12345678" });

		// É o que faz a próxima chamada já sair autenticada, sem o chamador
		// precisar lembrar de propagar o token.
		expect(getAccessToken()).toBe("jwt-do-login");
	});

	it("devolve a sessão completa", async () => {
		mock.onPost("/auth/login").reply(200, envelope(sessao()));

		const resultado = await AuthService.login({ email: "d@x.test", password: "12345678" });

		expect(resultado).toMatchObject({ tokenType: "Bearer", user: USUARIO });
	});

	it("propaga credencial inválida sem guardar token", async () => {
		mock.onPost("/auth/login").reply(...(envelopeErro("INVALID_CREDENTIALS", "Credenciais inválidas") as [number, object]));

		await expect(AuthService.login({ email: "d@x.test", password: "errada12" })).rejects.toMatchObject({
			code: "INVALID_CREDENTIALS",
		});
		expect(getAccessToken()).toBeUndefined();
	});

	it("propaga conta desativada", async () => {
		mock.onPost("/auth/login").reply(...(envelopeErro("USER_INACTIVE", "Conta desativada", 403) as [number, object]));

		await expect(AuthService.login({ email: "d@x.test", password: "12345678" })).rejects.toMatchObject({
			code: "USER_INACTIVE",
			status: 403,
		});
	});
});

describe("AuthService.refresh", () => {
	it("envia o refresh token", async () => {
		mock.onPost("/auth/refresh").reply(200, envelope(sessao()));

		await AuthService.refresh("meu-refresh-token-longo-o-bastante");

		expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
			refreshToken: "meu-refresh-token-longo-o-bastante",
		});
	});

	it("atualiza o access token em memória", async () => {
		setAccessToken("jwt-antigo");
		mock.onPost("/auth/refresh").reply(200, envelope(sessao("jwt-renovado")));

		await AuthService.refresh("refresh-token-com-tamanho-suficiente");

		expect(getAccessToken()).toBe("jwt-renovado");
	});

	it("propaga token inválido", async () => {
		mock.onPost("/auth/refresh").reply(...(envelopeErro("INVALID_REFRESH_TOKEN", "Inválido") as [number, object]));

		await expect(AuthService.refresh("token-revogado-mas-longo-o-bastante")).rejects.toMatchObject({
			code: "INVALID_REFRESH_TOKEN",
		});
	});
});

describe("AuthService.logout", () => {
	it("envia o refresh token para revogação", async () => {
		mock.onPost("/auth/logout").reply(200, envelope({ revoked: true }));

		await AuthService.logout("token-a-revogar-longo-o-bastante");

		expect(mock.history.post[0]!.url).toBe("/auth/logout");
	});

	it("limpa o access token em memória", async () => {
		setAccessToken("jwt-ativo");
		mock.onPost("/auth/logout").reply(200, envelope({ revoked: true }));

		await AuthService.logout("token-longo-o-bastante-para-passar");

		expect(getAccessToken()).toBeUndefined();
	});

	it("não propaga falha do servidor", async () => {
		mock.onPost("/auth/logout").reply(500, { erro: "qualquer" });

		// Se o servidor não conseguiu revogar, a sessão local cai de qualquer
		// forma. Deixar o usuário preso na tela seria pior do que um token que
		// expira sozinho em 15 minutos.
		await expect(AuthService.logout("token-longo-o-bastante-para-passar")).resolves.toBeUndefined();
	});

	it("limpa o token mesmo quando a revogação falha", async () => {
		setAccessToken("jwt-ativo");
		mock.onPost("/auth/logout").networkError();

		await AuthService.logout("token-longo-o-bastante-para-passar");

		expect(getAccessToken()).toBeUndefined();
	});
});

describe("AuthService.me", () => {
	it("consulta a identidade corrente", async () => {
		mock.onGet("/auth/me").reply(200, envelope(USUARIO));

		await expect(AuthService.me()).resolves.toEqual(USUARIO);
		expect(mock.history.get[0]!.url).toBe("/auth/me");
	});

	it("propaga 401 quando não há sessão válida", async () => {
		mock.onGet("/auth/me").reply(...(envelopeErro("INVALID_CREDENTIALS", "Sem identidade") as [number, object]));

		await expect(AuthService.me()).rejects.toMatchObject({ status: 401 });
	});
});
