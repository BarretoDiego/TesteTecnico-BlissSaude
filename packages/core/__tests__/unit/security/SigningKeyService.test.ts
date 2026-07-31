/**
 * Chave de assinatura dos tokens.
 *
 * É o ponto mais frágil da autenticação: quem assina (`bliss-auth`) e quem
 * valida (`bliss-authorizer`) precisam resolver **a mesma** chave. Divergir aqui
 * rejeita todo token emitido, e a falha aparece como 401 genérico — sem nada que
 * indique a causa. Por isso a precedência das origens é testada explicitamente.
 */

import type { SecretsManagerService } from "../../../src/aws/SecretsManagerService";
import { SigningKeyService } from "../../../src/security/SigningKeyService";

const ORIGINAL = { ...process.env };

function makeSecrets(signingKey = "chave-do-secrets-manager") {
	return {
		getSecretJson: jest.fn().mockResolvedValue({ signingKey }),
		clearCache: jest.fn(),
	} as unknown as jest.Mocked<SecretsManagerService>;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

beforeEach(() => {
	delete process.env.JWT_SECRET;
	delete process.env.JWT_SECRET_ID;
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("SigningKeyService.getKey", () => {
	it("usa JWT_SECRET quando definida", async () => {
		process.env.JWT_SECRET = "chave-local";
		const secrets = makeSecrets();

		const chave = await new SigningKeyService(secrets).getKey();

		expect(decode(chave)).toBe("chave-local");
		expect(secrets.getSecretJson).not.toHaveBeenCalled();
	});

	it("JWT_SECRET tem precedência sobre o Secrets Manager", async () => {
		process.env.JWT_SECRET = "chave-local";
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";
		const secrets = makeSecrets();

		// A precedência é o que permite rodar offline sem tocar a AWS. Invertê-la
		// faria o desenvolvimento local depender do Secrets Manager.
		expect(decode(await new SigningKeyService(secrets).getKey())).toBe("chave-local");
		expect(secrets.getSecretJson).not.toHaveBeenCalled();
	});

	it("busca no Secrets Manager quando só há JWT_SECRET_ID", async () => {
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";
		const secrets = makeSecrets("chave-remota");

		expect(decode(await new SigningKeyService(secrets).getKey())).toBe("chave-remota");
		expect(secrets.getSecretJson).toHaveBeenCalledWith("/local/saude-bliss/auth/jwt");
	});

	it("recusa quando nenhuma origem está configurada", async () => {
		// Falhar alto aqui é deliberado: uma chave vazia assinaria tokens que
		// qualquer um poderia forjar.
		await expect(new SigningKeyService(makeSecrets()).getKey()).rejects.toThrow(/JWT_SECRET/);
	});

	it("propaga a falha do Secrets Manager", async () => {
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";
		const secrets = makeSecrets();
		secrets.getSecretJson.mockRejectedValue(new Error("segredo inexistente"));

		await expect(new SigningKeyService(secrets).getKey()).rejects.toThrow("segredo inexistente");
	});

	it("consulta o Secrets Manager uma vez só", async () => {
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";
		const secrets = makeSecrets();
		const service = new SigningKeyService(secrets);

		await service.getKey();
		await service.getKey();
		await service.getKey();

		// Sem o cache, cada validação de token na Lambda pagaria uma chamada de
		// ~50ms ao Secrets Manager — no caminho de toda requisição autenticada.
		expect(secrets.getSecretJson).toHaveBeenCalledTimes(1);
	});

	it("devolve a mesma instância de chave entre chamadas", async () => {
		process.env.JWT_SECRET = "chave-local";
		const service = new SigningKeyService(makeSecrets());

		expect(await service.getKey()).toBe(await service.getKey());
	});
});

describe("SigningKeyService.resetCache", () => {
	it("força nova consulta e limpa o cache do Secrets Manager", async () => {
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";
		const secrets = makeSecrets();
		const service = new SigningKeyService(secrets);

		await service.getKey();
		service.resetCache();
		await service.getKey();

		// Limpar os dois níveis importa: sem o `clearCache` do Secrets Manager a
		// rotação devolveria a chave antiga, e o reset pareceria não funcionar.
		expect(secrets.getSecretJson).toHaveBeenCalledTimes(2);
		expect(secrets.clearCache).toHaveBeenCalled();
	});
});
