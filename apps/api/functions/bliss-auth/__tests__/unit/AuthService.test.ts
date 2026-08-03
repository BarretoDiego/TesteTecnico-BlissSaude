/**
 * Regras de autenticação.
 *
 * O foco são as decisões de segurança que um teste de caminho feliz não pega:
 * resposta indistinguível entre conta inexistente e senha errada, rotação de
 * refresh token, e a reação a um token revogado voltando.
 */

import type { AuthenticatedUser } from "@saude-bliss/contracts";
import { BlissError, PasswordService, SigningKeyService } from "@saude-bliss/core";
import { createHash } from "node:crypto";
import type { AuthRepository } from "../../src/repositories/AuthRepository";
import { AuthService } from "../../src/services/AuthService";

const KEY = new TextEncoder().encode("chave-de-teste-com-tamanho-mais-que-suficiente");

const USER: AuthenticatedUser = {
	id: "00000000-0000-4000-8000-000000000001",
	email: "daniel@saudebliss.test",
	name: "Daniel Morais",
	roles: ["reviewer"],
};

function makeRepository(overrides: Partial<jest.Mocked<AuthRepository>> = {}) {
	return {
		findCredentialsByEmail: jest.fn().mockResolvedValue(null),
		findById: jest.fn().mockResolvedValue(USER),
		touchLastLogin: jest.fn().mockResolvedValue(undefined),
		storeRefreshToken: jest.fn().mockResolvedValue(undefined),
		findActiveRefreshToken: jest.fn().mockResolvedValue(null),
		rotateRefreshToken: jest.fn().mockResolvedValue(undefined),
		revokeRefreshToken: jest.fn().mockResolvedValue(true),
		revokeAllForUser: jest.fn().mockResolvedValue(1),
		refreshTokenExists: jest.fn().mockResolvedValue(null),
		ping: jest.fn().mockResolvedValue(true),
		...overrides,
	} as unknown as jest.Mocked<AuthRepository>;
}

function makeKeys() {
	return { getKey: jest.fn().mockResolvedValue(KEY), resetCache: jest.fn() } as unknown as SigningKeyService;
}

/** `PasswordService` real seria ~100ms por chamada — caro demais para unidade. */
function makePasswords(matches: boolean) {
	return { hash: jest.fn(), verify: jest.fn().mockResolvedValue(matches) } as unknown as PasswordService;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("AuthService.login", () => {
	it("emite access e refresh token para credencial válida", async () => {
		const repository = makeRepository({
			findCredentialsByEmail: jest.fn().mockResolvedValue({ user: USER, passwordHash: "hash", active: true }),
		});

		const session = await new AuthService(repository, makePasswords(true), makeKeys()).login({
			email: USER.email,
			password: "senha-correta",
		});

		expect(session.tokenType).toBe("Bearer");
		expect(session.accessToken.split(".")).toHaveLength(3);
		expect(session.refreshToken.length).toBeGreaterThanOrEqual(32);
		expect(session.user).toEqual(USER);
	});

	it("guarda o refresh token com hash, nunca em claro", async () => {
		const repository = makeRepository({
			findCredentialsByEmail: jest.fn().mockResolvedValue({ user: USER, passwordHash: "hash", active: true }),
		});

		const session = await new AuthService(repository, makePasswords(true), makeKeys()).login({
			email: USER.email,
			password: "senha-correta",
		});

		// Vazamento de banco não pode virar sequestro de sessão.
		expect(repository.storeRefreshToken).toHaveBeenCalledWith(
			expect.objectContaining({ userId: USER.id, tokenHash: sha256(session.refreshToken) })
		);
	});

	it("registra o último acesso", async () => {
		const repository = makeRepository({
			findCredentialsByEmail: jest.fn().mockResolvedValue({ user: USER, passwordHash: "hash", active: true }),
		});

		await new AuthService(repository, makePasswords(true), makeKeys()).login({
			email: USER.email,
			password: "x",
		});

		expect(repository.touchLastLogin).toHaveBeenCalledWith(USER.id);
	});

	it.each([
		["e-mail inexistente", null, true],
		["senha errada", { user: USER, passwordHash: "hash", active: true }, false],
	])("responde INVALID_CREDENTIALS para %s", async (_case, stored, matches) => {
		const repository = makeRepository({ findCredentialsByEmail: jest.fn().mockResolvedValue(stored) });

		// A **mesma** resposta nos dois casos: distingui-los entregaria um oráculo
		// de enumeração de contas.
		await expect(
			new AuthService(repository, makePasswords(matches), makeKeys()).login({ email: "x@y.test", password: "z" })
		).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", httpStatus: 401 });
	});

	it("deriva a senha mesmo quando o e-mail não existe", async () => {
		const passwords = makePasswords(false);
		const repository = makeRepository({ findCredentialsByEmail: jest.fn().mockResolvedValue(null) });

		await new AuthService(repository, passwords, makeKeys())
			.login({ email: "nao-existe@y.test", password: "z" })
			.catch(() => undefined);

		// Sem isso, e-mail inexistente responde em ~1ms e existente em ~100ms — a
		// diferença é medível e transforma o login num oráculo.
		expect(passwords.verify).toHaveBeenCalled();
	});

	it("responde USER_INACTIVE só depois de a senha conferir", async () => {
		const repository = makeRepository({
			findCredentialsByEmail: jest.fn().mockResolvedValue({ user: USER, passwordHash: "hash", active: false }),
		});

		await expect(
			new AuthService(repository, makePasswords(true), makeKeys()).login({ email: USER.email, password: "ok" })
		).rejects.toMatchObject({ code: "USER_INACTIVE", httpStatus: 403 });
	});

	it("não revela conta desativada quando a senha está errada", async () => {
		const repository = makeRepository({
			findCredentialsByEmail: jest.fn().mockResolvedValue({ user: USER, passwordHash: "hash", active: false }),
		});

		// Do contrário o status da conta viraria oráculo: quem ataca descobriria
		// e-mails cadastrados sem saber senha nenhuma.
		await expect(
			new AuthService(repository, makePasswords(false), makeKeys()).login({ email: USER.email, password: "errada" })
		).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
	});

	it("não emite sessão quando a autenticação falha", async () => {
		const repository = makeRepository({ findCredentialsByEmail: jest.fn().mockResolvedValue(null) });

		await new AuthService(repository, makePasswords(false), makeKeys())
			.login({ email: "x@y.test", password: "z" })
			.catch(() => undefined);

		expect(repository.storeRefreshToken).not.toHaveBeenCalled();
	});
});

describe("AuthService.refresh", () => {
	it("rotaciona: revoga o antigo e emite um novo par", async () => {
		const repository = makeRepository({
			findActiveRefreshToken: jest.fn().mockResolvedValue({ id: "sessao-1", userId: USER.id }),
		});

		const session = await new AuthService(repository, makePasswords(true), makeKeys()).refresh("token-antigo");

		expect(repository.rotateRefreshToken).toHaveBeenCalledWith(
			"sessao-1",
			expect.objectContaining({ userId: USER.id, tokenHash: sha256(session.refreshToken) })
		);
		expect(session.refreshToken).not.toBe("token-antigo");
	});

	it("recusa refresh token desconhecido", async () => {
		const repository = makeRepository();

		await expect(
			new AuthService(repository, makePasswords(true), makeKeys()).refresh("nunca-existiu")
		).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN", httpStatus: 401 });
	});

	it("derruba todas as sessões quando um token revogado é reapresentado", async () => {
		// Detecção de reuso da OAuth 2.0 Security BCP: um token revogado voltando
		// significa que ele vazou ou que há duas cópias em uso.
		const repository = makeRepository({
			findActiveRefreshToken: jest.fn().mockResolvedValue(null),
			refreshTokenExists: jest.fn().mockResolvedValue({ userId: USER.id }),
		});

		await expect(
			new AuthService(repository, makePasswords(true), makeKeys()).refresh("token-reusado")
		).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });

		expect(repository.revokeAllForUser).toHaveBeenCalledWith(USER.id);
	});

	it("não derruba sessões quando o token nunca existiu", async () => {
		const repository = makeRepository();

		await new AuthService(repository, makePasswords(true), makeKeys()).refresh("lixo").catch(() => undefined);

		expect(repository.revokeAllForUser).not.toHaveBeenCalled();
	});

	it("recusa quando o usuário da sessão não existe mais", async () => {
		const repository = makeRepository({
			findActiveRefreshToken: jest.fn().mockResolvedValue({ id: "sessao-1", userId: USER.id }),
			findById: jest.fn().mockResolvedValue(null),
		});

		await expect(new AuthService(repository, makePasswords(true), makeKeys()).refresh("token")).rejects.toMatchObject({
			code: "INVALID_REFRESH_TOKEN",
		});
	});
});

describe("AuthService.logout", () => {
	it("revoga o refresh token pelo hash", async () => {
		const repository = makeRepository();

		await new AuthService(repository, makePasswords(true), makeKeys()).logout("meu-token");

		expect(repository.revokeRefreshToken).toHaveBeenCalledWith(sha256("meu-token"));
	});

	it("é idempotente — revogar duas vezes não é erro", async () => {
		const repository = makeRepository({ revokeRefreshToken: jest.fn().mockResolvedValue(false) });

		// Devolver 404 aqui vazaria quais tokens existem, sem nada que o cliente
		// pudesse fazer de diferente com a informação.
		await expect(
			new AuthService(repository, makePasswords(true), makeKeys()).logout("já-revogado")
		).resolves.toBeUndefined();
	});
});

describe("AuthService.resolvePrincipal", () => {
	it("registra o motivo mesmo quando a falha não é um Error", async () => {
		// Rejeição com valor cru — um SDK que rejeita com string, um `throw` de
		// literal. `error.message` seria `undefined` e a linha de log sairia sem o
		// motivo, justamente na investigação de "por que este token não passa".
		const logFailed = jest.spyOn(AuthService.prototype as unknown as { logFailed: () => void }, "logFailed");
		const keys = {
			getKey: jest.fn().mockRejectedValue("segredo de assinatura indisponível"),
			resetCache: jest.fn(),
		} as unknown as SigningKeyService;

		const service = new AuthService(makeRepository(), makePasswords(true), keys);

		await expect(service.resolvePrincipal("Bearer token-qualquer")).rejects.toBeInstanceOf(BlissError);
		expect(logFailed).toHaveBeenCalledWith(
			expect.any(String),
			"resolvePrincipal",
			"token inválido",
			expect.objectContaining({ reason: "segredo de assinatura indisponível" })
		);
	});

	it("não vaza o motivo interno na resposta", async () => {
		const keys = {
			getKey: jest.fn().mockRejectedValue("segredo de assinatura indisponível"),
			resetCache: jest.fn(),
		} as unknown as SigningKeyService;

		const service = new AuthService(makeRepository(), makePasswords(true), keys);

		// O motivo vai para o log, não para o cliente: detalhe de infraestrutura na
		// resposta de autenticação é reconhecimento gratuito para quem sonda.
		await expect(service.resolvePrincipal("Bearer token-qualquer")).rejects.toMatchObject({
			message: "Token inválido ou expirado",
		});
	});
});

describe("AuthService.me", () => {
	it("resolve a identidade a partir do id", async () => {
		const repository = makeRepository();

		await expect(new AuthService(repository, makePasswords(true), makeKeys()).me(USER.id)).resolves.toEqual(USER);
	});

	it("recusa quando o usuário do token não existe mais", async () => {
		const repository = makeRepository({ findById: jest.fn().mockResolvedValue(null) });

		await expect(new AuthService(repository, makePasswords(true), makeKeys()).me(USER.id)).rejects.toBeInstanceOf(
			BlissError
		);
	});
});

describe("AuthService.checkDatabase", () => {
	it("reporta saudável quando o banco responde", async () => {
		const repository = makeRepository();

		await expect(new AuthService(repository, makePasswords(true), makeKeys()).checkDatabase()).resolves.toBe(true);
		expect(repository.ping).toHaveBeenCalled();
	});
});

/**
 * Definição do microserviço.
 *
 * O `service.ts` existe para que `app.ts` (a Lambda) e `run.all.local.ts` (todos
 * os domínios num processo) leiam a **mesma** definição. Quando nome e prefixo
 * estavam declarados nos dois lugares, podiam divergir sem ninguém notar — e o
 * sintoma aparecia só no deploy, como 403 do API Gateway.
 */
describe("definição do serviço", () => {
	it("declara nome e prefixo coerentes com o router", async () => {
		const { service, ROUTE_PREFIX } = await import("../../src/service");
		const { ROUTE_PREFIX: doRouter } = await import("../../src/router");

		expect(service.name).toBe("bliss-auth");
		expect(service.routePrefix).toBe("/auth");
		// O prefixo reexportado precisa ser o do router, não uma cópia.
		expect(ROUTE_PREFIX).toBe(doRouter);
	});

	it("a sonda de saúde consulta o banco de fato", async () => {
		const consulta = jest.spyOn(AuthService.prototype, "checkDatabase").mockResolvedValue(true);
		const { service } = await import("../../src/service");

		await expect(service.healthProbe?.()).resolves.toBe(true);

		// Não basta existir: uma sonda que devolve `true` sem tocar a dependência
		// crítica reporta saudável enquanto toda requisição real falha.
		expect(consulta).toHaveBeenCalled();
	});
});
