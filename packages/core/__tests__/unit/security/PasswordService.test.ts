/**
 * Derivação de senha.
 *
 * O que se verifica aqui é o que separa um hash de senha de uma criptografia
 * ingênua: salt por senha, verificação com os parâmetros gravados no hash e
 * recusa silenciosa de entrada malformada.
 */

import { PasswordService } from "../../../src/security/PasswordService";

const service = new PasswordService();

describe("PasswordService", () => {
	it("verifica a senha correta", async () => {
		const hash = await service.hash("senha-correta-123");

		await expect(service.verify("senha-correta-123", hash)).resolves.toBe(true);
	});

	it("recusa a senha errada", async () => {
		const hash = await service.hash("senha-correta-123");

		await expect(service.verify("senha-errada-123", hash)).resolves.toBe(false);
	});

	it("gera hashes distintos para a mesma senha", async () => {
		const [first, second] = await Promise.all([service.hash("mesma-senha"), service.hash("mesma-senha")]);

		// Salt por senha: sem ele, duas contas com a mesma senha teriam o mesmo
		// hash, e uma rainbow table quebraria as duas de uma vez.
		expect(first).not.toBe(second);
	});

	it("grava os parâmetros dentro do hash", async () => {
		const hash = await service.hash("qualquer");

		// É o que permite endurecer o custo no futuro sem invalidar as senhas já
		// cadastradas — cada linha é verificada com os parâmetros que a geraram.
		expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
	});

	it("verifica contra os parâmetros do próprio hash, não os atuais", async () => {
		const legado = await service.hash("senha-antiga");
		const comCustoMenor = legado.replace(/^scrypt\$\d+/, "scrypt$16384");

		// Parâmetro diferente do usado na derivação produz hash diferente. O que se
		// afirma é que a verificação lê o hash em vez de assumir a constante atual:
		// não quebra, e também não aceita por engano.
		await expect(service.verify("senha-antiga", comCustoMenor)).resolves.toBe(false);
		await expect(service.verify("senha-antiga", legado)).resolves.toBe(true);
	});

	it.each([
		["vazio", ""],
		["sem esquema", "abc$def"],
		["esquema desconhecido", "bcrypt$1$2$3$abc$def"],
		["campos faltando", "scrypt$32768$8"],
	])("recusa hash %s sem lançar", async (_case, stored) => {
		// Hash corrompido no banco não pode derrubar o login com exceção — vira
		// credencial inválida, que é o efeito correto.
		await expect(service.verify("qualquer", stored)).resolves.toBe(false);
	});

	it("recusa senha vazia contra hash válido", async () => {
		const hash = await service.hash("senha-real");

		await expect(service.verify("", hash)).resolves.toBe(false);
	});
});
