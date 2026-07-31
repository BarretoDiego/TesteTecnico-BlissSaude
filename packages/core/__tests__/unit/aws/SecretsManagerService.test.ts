/**
 * Leitura de segredos.
 *
 * Cobre o que o teste do `SecretsService` não alcança por consumi-lo pronto: o
 * cache, o segredo binário e o JSON corrompido — que precisa falhar com
 * mensagem própria em vez de vazar um `SyntaxError` do `JSON.parse`.
 */

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { resetAwsClients } from "../../../src/aws/AwsClientFactory";
import { SecretsManagerService } from "../../../src/aws/SecretsManagerService";

const secretsMock = mockClient(SecretsManagerClient);

beforeEach(() => {
	secretsMock.reset();
	resetAwsClients();
});

describe("SecretsManagerService.getSecretString", () => {
	it("devolve o conteúdo do segredo", async () => {
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: "valor-secreto" });

		await expect(new SecretsManagerService().getSecretString("/algum/segredo")).resolves.toBe("valor-secreto");
	});

	it("consulta uma vez e serve as demais do cache", async () => {
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: "valor" });
		const service = new SecretsManagerService();

		await service.getSecretString("/algum/segredo");
		await service.getSecretString("/algum/segredo");

		// Cada leitura custa ~50ms e entra na conta de API calls. Na Lambda isso
		// estaria no caminho de toda requisição.
		expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
	});

	it("consulta de novo depois de limpar o cache", async () => {
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: "valor" });
		const service = new SecretsManagerService();

		await service.getSecretString("/algum/segredo");
		service.clearCache();
		await service.getSecretString("/algum/segredo");

		expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(2);
	});

	it("recusa segredo sem conteúdo de texto", async () => {
		// Segredo binário não serve para nada aqui, e devolver string vazia faria
		// a credencial falhar depois, longe da causa.
		secretsMock.on(GetSecretValueCommand).resolves({});

		await expect(new SecretsManagerService().getSecretString("/binario")).rejects.toThrow(/binario/);
	});

	it("propaga a falha da AWS", async () => {
		secretsMock.on(GetSecretValueCommand).rejects(new Error("acesso negado"));

		await expect(new SecretsManagerService().getSecretString("/negado")).rejects.toThrow("acesso negado");
	});
});

describe("SecretsManagerService.getSecretJson", () => {
	it("desserializa o segredo", async () => {
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ signingKey: "abc" }) });

		await expect(new SecretsManagerService().getSecretJson("/jwt")).resolves.toEqual({ signingKey: "abc" });
	});

	it("recusa JSON malformado com mensagem própria", async () => {
		secretsMock.on(GetSecretValueCommand).resolves({ SecretString: "{ isto não é json" });

		// `SyntaxError: Unexpected token` não diz **qual** segredo está corrompido;
		// a mensagem própria nomeia o recurso e poupa a investigação.
		await expect(new SecretsManagerService().getSecretJson("/jwt")).rejects.toThrow(/\/jwt.*JSON válido/);
	});
});
