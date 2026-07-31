/**
 * Repositório de autenticação contra Postgres real.
 *
 * Única camada que exercita o SQL de verdade, e vale por três coisas que mock
 * não prova: que a **rotação** revoga o antigo e grava o novo na mesma
 * transação, que a busca de token ativo respeita revogação **e** expiração, e
 * que a revogação em massa atinge só o usuário certo.
 *
 * Requer o Postgres do compose no ar (`pnpm infra:up`) com as migrations
 * aplicadas. Pule com `SKIP_E2E=1`.
 */

import { closeDb, getDb, refreshTokens, users } from "@saude-bliss/database";
import { eq, like } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { AuthRepository } from "../../src/repositories/AuthRepository";

const describeE2E = process.env.SKIP_E2E === "1" ? describe.skip : describe;

/** Marca por execução: limpa só o que criou e convive com o seed. */
const RUN = `e2e-auth-${process.pid}`;
const email = (nome: string) => `${RUN}.${nome}@saudebliss.test`;

const repository = new AuthRepository();

const hashDe = (token: string) => createHash("sha256").update(token).digest("hex");
const daquiA = (ms: number) => new Date(Date.now() + ms);

async function cleanup(): Promise<void> {
	const db = await getDb();
	// `refresh_tokens` cai junto pelo ON DELETE CASCADE da FK.
	await db.delete(users).where(like(users.email, `${RUN}%`));
}

/** Cria um usuário direto pelo Drizzle — inserir usuário não é papel do repositório. */
async function criarUsuario(nome: string, overrides: { active?: boolean } = {}) {
	const db = await getDb();
	const [row] = await db
		.insert(users)
		.values({
			email: email(nome),
			name: `Usuário ${nome}`,
			passwordHash: "scrypt$32768$8$1$c2FsdA$aGFzaA",
			roles: ["requester"],
			active: overrides.active ?? true,
		})
		.returning();
	return row!;
}

beforeAll(cleanup);

afterAll(async () => {
	await cleanup();
	await closeDb();
});

describeE2E("AuthRepository — credenciais", () => {
	it("encontra por e-mail e devolve o hash e o status", async () => {
		const usuario = await criarUsuario("ana");

		const encontrado = await repository.findCredentialsByEmail(email("ana"));

		expect(encontrado).toMatchObject({
			user: { id: usuario.id, email: email("ana"), roles: ["requester"] },
			passwordHash: "scrypt$32768$8$1$c2FsdA$aGFzaA",
			active: true,
		});
	});

	it("devolve conta desativada em vez de escondê-la", async () => {
		await criarUsuario("inativo", { active: false });

		// Filtrar por `active` na query impediria o service de responder 403 —
		// e ele precisa distinguir "não existe" de "existe mas está desativada",
		// só que depois de conferir a senha.
		await expect(repository.findCredentialsByEmail(email("inativo"))).resolves.toMatchObject({ active: false });
	});

	it("devolve null para e-mail inexistente", async () => {
		await expect(repository.findCredentialsByEmail(email("ninguem"))).resolves.toBeNull();
	});

	it("encontra por id sem expor o hash da senha", async () => {
		const usuario = await criarUsuario("bruno");

		const encontrado = await repository.findById(usuario.id);

		// `findById` alimenta o `/auth/me`, cuja resposta vai para o browser.
		expect(encontrado).toEqual({
			id: usuario.id,
			email: email("bruno"),
			name: "Usuário bruno",
			roles: ["requester"],
		});
	});

	it("devolve null para id inexistente", async () => {
		await expect(repository.findById(randomUUID())).resolves.toBeNull();
	});

	it("registra o último acesso", async () => {
		const usuario = await criarUsuario("carla");
		const db = await getDb();

		await repository.touchLastLogin(usuario.id);

		const [row] = await db.select().from(users).where(eq(users.id, usuario.id));
		expect(row!.lastLoginAt).toBeInstanceOf(Date);
	});
});

describeE2E("AuthRepository — refresh tokens", () => {
	it("grava e encontra o token ativo", async () => {
		const usuario = await criarUsuario("token-ativo");
		const hash = hashDe("token-1");

		await repository.storeRefreshToken({ userId: usuario.id, tokenHash: hash, expiresAt: daquiA(60_000) });

		await expect(repository.findActiveRefreshToken(hash)).resolves.toMatchObject({ userId: usuario.id });
	});

	it("não encontra token expirado", async () => {
		const usuario = await criarUsuario("token-expirado");
		const hash = hashDe("token-2");

		await repository.storeRefreshToken({ userId: usuario.id, tokenHash: hash, expiresAt: daquiA(-1_000) });

		// Expirado precisa sair pela query, não por checagem no service: um token
		// vencido que ainda "existe" acaba aceito por algum caminho esquecido.
		await expect(repository.findActiveRefreshToken(hash)).resolves.toBeNull();
	});

	it("não encontra token revogado", async () => {
		const usuario = await criarUsuario("token-revogado");
		const hash = hashDe("token-3");

		await repository.storeRefreshToken({ userId: usuario.id, tokenHash: hash, expiresAt: daquiA(60_000) });
		await repository.revokeRefreshToken(hash);

		await expect(repository.findActiveRefreshToken(hash)).resolves.toBeNull();
	});

	it("revoga o antigo e grava o novo na mesma transação", async () => {
		const usuario = await criarUsuario("rotacao");
		const antigo = hashDe("antigo");
		const novo = hashDe("novo");

		await repository.storeRefreshToken({ userId: usuario.id, tokenHash: antigo, expiresAt: daquiA(60_000) });
		const ativo = await repository.findActiveRefreshToken(antigo);

		await repository.rotateRefreshToken(ativo!.id, {
			userId: usuario.id,
			tokenHash: novo,
			expiresAt: daquiA(60_000),
		});

		// A transação é o ponto: sem ela, uma falha entre os dois passos deixaria
		// o usuário com duas sessões válidas ou com nenhuma.
		await expect(repository.findActiveRefreshToken(antigo)).resolves.toBeNull();
		await expect(repository.findActiveRefreshToken(novo)).resolves.toMatchObject({ userId: usuario.id });
	});

	it("marca a substituição para permitir detectar reuso", async () => {
		const usuario = await criarUsuario("reuso");
		const antigo = hashDe("reuso-antigo");
		const db = await getDb();

		await repository.storeRefreshToken({ userId: usuario.id, tokenHash: antigo, expiresAt: daquiA(60_000) });
		const ativo = await repository.findActiveRefreshToken(antigo);
		await repository.rotateRefreshToken(ativo!.id, {
			userId: usuario.id,
			tokenHash: hashDe("reuso-novo"),
			expiresAt: daquiA(60_000),
		});

		// O token revogado continua existindo: é o que permite reconhecer que ele
		// voltou — sinal de vazamento — em vez de tratá-lo como desconhecido.
		const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, antigo));
		expect(row!.revokedAt).toBeInstanceOf(Date);
	});

	it("revogar devolve false quando o token não existe", async () => {
		await expect(repository.revokeRefreshToken(hashDe("nunca-existiu"))).resolves.toBe(false);
	});

	it("reconhece token revogado como existente", async () => {
		const usuario = await criarUsuario("existente");
		const hash = hashDe("existente-1");

		await repository.storeRefreshToken({ userId: usuario.id, tokenHash: hash, expiresAt: daquiA(60_000) });
		await repository.revokeRefreshToken(hash);

		// `findActiveRefreshToken` devolve null e `refreshTokenExists` não: é
		// dessa diferença que sai a detecção de reuso.
		await expect(repository.refreshTokenExists(hash)).resolves.toMatchObject({ userId: usuario.id });
	});

	it("revoga todas as sessões de um usuário sem tocar nas dos outros", async () => {
		const alvo = await criarUsuario("alvo");
		const outro = await criarUsuario("outro");

		for (const nome of ["s1", "s2", "s3"]) {
			await repository.storeRefreshToken({
				userId: alvo.id,
				tokenHash: hashDe(`alvo-${nome}`),
				expiresAt: daquiA(60_000),
			});
		}
		await repository.storeRefreshToken({
			userId: outro.id,
			tokenHash: hashDe("outro-s1"),
			expiresAt: daquiA(60_000),
		});

		await expect(repository.revokeAllForUser(alvo.id)).resolves.toBe(3);

		// A revogação em massa dispara na detecção de reuso; atingir usuário
		// errado deslogaria alguém que não tem nada a ver com o incidente.
		await expect(repository.findActiveRefreshToken(hashDe("alvo-s1"))).resolves.toBeNull();
		await expect(repository.findActiveRefreshToken(hashDe("outro-s1"))).resolves.not.toBeNull();
	});

	it("remove os tokens expirados na limpeza", async () => {
		const usuario = await criarUsuario("purga");

		await repository.storeRefreshToken({
			userId: usuario.id,
			tokenHash: hashDe("purga-vencido"),
			expiresAt: daquiA(-60_000),
		});
		await repository.storeRefreshToken({
			userId: usuario.id,
			tokenHash: hashDe("purga-valido"),
			expiresAt: daquiA(60_000),
		});

		await repository.purgeExpired();

		await expect(repository.refreshTokenExists(hashDe("purga-vencido"))).resolves.toBeNull();
		await expect(repository.refreshTokenExists(hashDe("purga-valido"))).resolves.not.toBeNull();
	});
});

describeE2E("AuthRepository.ping", () => {
	it("confirma que o banco responde", async () => {
		await expect(repository.ping()).resolves.toBe(true);
	});
});
