/**
 * @jest-environment node
 */

/**
 * Resolução da origem da API no **servidor**.
 *
 * Ambiente `node` de propósito: `resolveBaseUrl` decide pelo `typeof window`, e
 * sob jsdom `window` sempre existe — o caminho de servidor seria inalcançável.
 * É o caminho que os Server Components usam, ou seja, a maior parte das telas
 * do backoffice.
 *
 * A distinção entre as duas variáveis existe porque as chamadas saem de lugares
 * diferentes: do container, no servidor; da máquina do usuário, no browser. Em
 * desenvolvimento apontam para o mesmo endereço e a diferença é invisível — em
 * qualquer deploy conteinerizado ela decide se a página renderiza ou erra.
 */

const ORIGINAL = { ...process.env };

/** Carrega o módulo do zero e devolve a origem que o cliente adotou. */
function baseUrlResolvida(): string | undefined {
	let url: string | undefined;
	jest.isolateModules(() => {
		url = (require("~/services/instances") as typeof import("~/services/instances")).apiClient.defaults.baseURL;
	});
	return url;
}

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("resolveBaseUrl — no servidor", () => {
	it("prefere API_BASE_URL", () => {
		process.env.API_BASE_URL = "http://interna-do-container/v1";
		process.env.NEXT_PUBLIC_API_BASE_URL = "https://publica/v1";

		// No servidor a chamada sai de dentro da rede: o endereço interno é o certo,
		// e o público pode nem ser resolvível de lá.
		expect(baseUrlResolvida()).toBe("http://interna-do-container/v1");
	});

	it("cai para NEXT_PUBLIC_API_BASE_URL quando API_BASE_URL não existe", () => {
		delete process.env.API_BASE_URL;
		process.env.NEXT_PUBLIC_API_BASE_URL = "https://publica/v1";

		// É o caso do `pnpm start`: o `export-outputs.sh` grava as duas, mas um
		// deploy que só defina a pública precisa continuar renderizando.
		expect(baseUrlResolvida()).toBe("https://publica/v1");
	});

	it("cai para localhost:4000 quando nenhuma das duas existe", () => {
		delete process.env.API_BASE_URL;
		delete process.env.NEXT_PUBLIC_API_BASE_URL;

		expect(baseUrlResolvida()).toBe("http://localhost:4000/v1");
	});
});
