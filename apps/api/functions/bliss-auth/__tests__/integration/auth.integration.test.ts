/**
 * Endpoints de autenticação ponta a ponta pela aplicação.
 *
 * Roda com `app.inject()` e repositório mockado: exercita rota, middleware,
 * controller e envelope sem socket nem banco. É a camada que pega o que o teste
 * unitário do `AuthService` não vê — validação de entrada, mapeamento de erro
 * para status, e a resolução de identidade do `/auth/me`, que tem dois caminhos.
 */

import type { AuthenticatedUser } from "@saude-bliss/contracts";
import { REQUEST_ID_HEADER } from "@saude-bliss/contracts";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";

const SECRET = "chave-de-teste-com-tamanho-mais-que-suficiente";

const USER: AuthenticatedUser = {
	id: "00000000-0000-4000-8000-000000000001",
	email: "daniel.morais@saudebliss.test",
	name: "Daniel Morais",
	roles: ["admin", "reviewer"],
};

const repository = {
	findCredentialsByEmail: jest.fn(),
	findById: jest.fn(),
	touchLastLogin: jest.fn(),
	storeRefreshToken: jest.fn(),
	findActiveRefreshToken: jest.fn(),
	rotateRefreshToken: jest.fn(),
	revokeRefreshToken: jest.fn(),
	revokeAllForUser: jest.fn(),
	refreshTokenExists: jest.fn(),
	ping: jest.fn(),
};

jest.mock("../../src/repositories/AuthRepository", () => ({
	AuthRepository: jest.fn().mockImplementation(() => repository),
}));

let app: FastifyInstance;

/** Senha real do seed derivada uma vez — `scrypt` custa ~100ms por chamada. */
let passwordHash: string;

beforeAll(async () => {
	process.env.JWT_SECRET = SECRET;

	const { PasswordService } = await import("@saude-bliss/core");
	passwordHash = await new PasswordService().hash("saudebliss123");

	const { buildApp } = await import("../../src/app");
	app = await buildApp();
	await app.ready();
});

afterAll(async () => {
	await app.close();
});

beforeEach(() => {
	repository.ping.mockResolvedValue(true);
	repository.findById.mockResolvedValue(USER);
	repository.findCredentialsByEmail.mockResolvedValue({ user: USER, passwordHash, active: true });
	repository.touchLastLogin.mockResolvedValue(undefined);
	repository.storeRefreshToken.mockResolvedValue(undefined);
	repository.findActiveRefreshToken.mockResolvedValue(null);
	repository.refreshTokenExists.mockResolvedValue(null);
	repository.revokeRefreshToken.mockResolvedValue(true);
	repository.revokeAllForUser.mockResolvedValue(1);
});

async function login(password = "saudebliss123") {
	return app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: USER.email, password } });
}

async function mintToken(overrides: Record<string, unknown> = {}) {
	return new SignJWT({ email: USER.email, roles: USER.roles, ...overrides })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject((overrides.sub as string) ?? USER.id)
		.setIssuer("saude-bliss")
		.setAudience("saude-bliss-api")
		.setIssuedAt()
		.setExpirationTime("1h")
		.sign(new TextEncoder().encode(SECRET));
}

describe("POST /v1/auth/login", () => {
	it("responde 200 com a sessão dentro do envelope", async () => {
		const response = await login();

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.success).toBe(true);
		expect(body.data.tokenType).toBe("Bearer");
		expect(body.data.user).toEqual(USER);
	});

	it("não devolve o hash da senha em lugar nenhum da resposta", async () => {
		const response = await login();

		// O `findCredentialsByEmail` devolve o hash junto com o usuário; vazá-lo
		// para o cliente entregaria material para ataque offline.
		expect(response.body).not.toContain(passwordHash.slice(0, 24));
	});

	it("responde 401 para senha errada", async () => {
		const response = await login("senha-errada");

		expect(response.statusCode).toBe(401);
		expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
	});

	it("responde o mesmo 401 para e-mail inexistente", async () => {
		repository.findCredentialsByEmail.mockResolvedValue(null);

		const response = await login();

		// Idêntico ao caso de senha errada, de propósito: distinguir os dois
		// entregaria um oráculo de enumeração de contas.
		expect(response.statusCode).toBe(401);
		expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
	});

	it("responde 403 para conta desativada", async () => {
		repository.findCredentialsByEmail.mockResolvedValue({ user: USER, passwordHash, active: false });

		const response = await login();

		expect(response.statusCode).toBe(403);
		expect(response.json().error.code).toBe("USER_INACTIVE");
	});

	it.each([
		["corpo vazio", {}],
		["e-mail malformado", { email: "não-é-email", password: "saudebliss123" }],
		["sem senha", { email: USER.email }],
		["senha curta demais", { email: USER.email, password: "123" }],
	])("responde 400 para %s", async (_caso, payload) => {
		const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload });

		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("VALIDATION_ERROR");
	});

	it("responde 503 quando o banco está fora", async () => {
		repository.findCredentialsByEmail.mockRejectedValue(Object.assign(new Error("sem conexão"), { code: "08006" }));

		const response = await login();

		// 503 e não 500: sinaliza ao cliente que a operação é retentável.
		expect(response.statusCode).toBe(503);
	});
});

describe("POST /v1/auth/refresh", () => {
	it("rotaciona e devolve um par novo", async () => {
		repository.findActiveRefreshToken.mockResolvedValue({ id: "sessao-1", userId: USER.id });

		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/refresh",
			payload: { refreshToken: "token-antigo-com-tamanho-suficiente" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().data.refreshToken).not.toBe("token-antigo-com-tamanho-suficiente");
		expect(repository.rotateRefreshToken).toHaveBeenCalled();
	});

	it("responde 401 para token desconhecido", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/refresh",
			payload: { refreshToken: "nunca-existiu-com-tamanho-suficiente" },
		});

		expect(response.statusCode).toBe(401);
		expect(response.json().error.code).toBe("INVALID_REFRESH_TOKEN");
	});

	it("derruba todas as sessões quando um token revogado é reapresentado", async () => {
		repository.refreshTokenExists.mockResolvedValue({ userId: USER.id });

		await app.inject({
			method: "POST",
			url: "/v1/auth/refresh",
			payload: { refreshToken: "reusado-com-tamanho-mais-que-suficiente" },
		});

		// Detecção de reuso da OAuth 2.0 Security BCP: token revogado voltando
		// significa que vazou ou que há duas cópias em uso.
		expect(repository.revokeAllForUser).toHaveBeenCalledWith(USER.id);
	});

	it("responde 400 sem o refreshToken", async () => {
		const response = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: {} });

		expect(response.statusCode).toBe(400);
	});
});

describe("POST /v1/auth/logout", () => {
	it("revoga e responde 200", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/logout",
			payload: { refreshToken: "meu-token-com-tamanho-suficiente" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().data.revoked).toBe(true);
	});

	it("é idempotente — revogar duas vezes segue 200", async () => {
		repository.revokeRefreshToken.mockResolvedValue(false);

		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/logout",
			payload: { refreshToken: "ja-revogado-com-tamanho-suficiente" },
		});

		// 404 aqui vazaria quais tokens existem, sem nada que o cliente pudesse
		// fazer de diferente com a informação.
		expect(response.statusCode).toBe(200);
	});

	it("responde 400 sem o refreshToken", async () => {
		const response = await app.inject({ method: "POST", url: "/v1/auth/logout", payload: {} });

		expect(response.statusCode).toBe(400);
	});
});

describe("GET /v1/auth/me", () => {
	it("resolve a identidade a partir do token quando não há authorizer", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { authorization: `Bearer ${await mintToken()}` },
		});

		// Este é o caminho que mantém o endpoint utilizável fora da Lambda — nem
		// `run.all.local` nem o LocalStack Community executam authorizer.
		expect(response.statusCode).toBe(200);
		expect(response.json().data).toEqual(USER);
	});

	it("responde 401 sem credencial", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/auth/me" });

		expect(response.statusCode).toBe(401);
	});

	it.each([
		["sem esquema Bearer", "apenas-o-token"],
		["esquema errado", "Basic dXNlcjpwYXNz"],
		["token forjado", "Bearer nao.e.um.jwt"],
	])("responde 401 para %s", async (_caso, authorization) => {
		const response = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { authorization } });

		expect(response.statusCode).toBe(401);
	});

	it("responde 401 quando o token não traz sub", async () => {
		const semSub = await new SignJWT({ email: USER.email })
			.setProtectedHeader({ alg: "HS256" })
			.setIssuer("saude-bliss")
			.setAudience("saude-bliss-api")
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(SECRET));

		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { authorization: `Bearer ${semSub}` },
		});

		expect(response.statusCode).toBe(401);
	});

	it("responde 401 quando o usuário do token não existe mais", async () => {
		repository.findById.mockResolvedValue(null);

		const response = await app.inject({
			method: "GET",
			url: "/v1/auth/me",
			headers: { authorization: `Bearer ${await mintToken()}` },
		});

		expect(response.statusCode).toBe(401);
	});
});

describe("GET /v1/auth/health", () => {
	it("responde 200 com o banco acessível", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/auth/health" });

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toMatchObject({ service: "bliss-auth", status: "ok", dependencies: "up" });
	});

	it("responde 503 com o banco fora", async () => {
		repository.ping.mockRejectedValue(new Error("sem conexão"));

		const response = await app.inject({ method: "GET", url: "/v1/auth/health" });

		// Um healthcheck que não toca a dependência crítica reporta "saudável"
		// enquanto toda requisição real falha.
		expect(response.statusCode).toBe(503);
	});
});

describe("rastreabilidade", () => {
	it("devolve o requestId enviado no envelope e no header", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/login",
			headers: { [REQUEST_ID_HEADER]: "trace-auth-1" },
			payload: { email: USER.email, password: "saudebliss123" },
		});

		expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-auth-1");
		expect(response.json().requestId).toBe("trace-auth-1");
	});

	it("gera um id quando o cliente não envia, e usa o mesmo nos dois lugares", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/auth/health" });

		const doHeader = response.headers[REQUEST_ID_HEADER];
		expect(doHeader).toBeTruthy();
		expect(response.json().requestId).toBe(doHeader);
	});

	it("mantém o requestId também nas respostas de erro", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/auth/login",
			headers: { [REQUEST_ID_HEADER]: "trace-auth-erro" },
			payload: {},
		});

		// Correlacionar a falha é justamente quando o trace importa mais.
		expect(response.statusCode).toBe(400);
		expect(response.json().requestId).toBe("trace-auth-erro");
	});
});
