/**
 * Resolução da origem da API no **browser**.
 *
 * `resolveBaseUrl` roda uma vez, na carga do módulo, e decide de onde as
 * chamadas saem. Errar aqui não quebra um endpoint: quebra todos de uma vez, e
 * com a mensagem menos útil possível — falha de rede, sem indício de que a
 * origem é que estava errada.
 *
 * Cada caso reimporta o módulo com `resetModules`, porque a decisão acontece no
 * escopo do módulo e não há como reavaliá-la depois.
 *
 * O ramo de servidor mora em `instances.server.test.ts`, que roda sob o ambiente
 * `node` — sob jsdom `window` sempre existe e aquele caminho é inalcançável.
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

describe("resolveBaseUrl — no browser", () => {
	it("usa NEXT_PUBLIC_API_BASE_URL", () => {
		process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.exemplo/v1";

		expect(baseUrlResolvida()).toBe("https://api.exemplo/v1");
	});

	it("ignora API_BASE_URL, que é variável de servidor", () => {
		process.env.NEXT_PUBLIC_API_BASE_URL = "https://publica/v1";
		process.env.API_BASE_URL = "http://interna-do-container/v1";

		// A distinção é o motivo de existirem duas variáveis: um endereço interno
		// de container chegando ao browser produz falha de rede em toda chamada,
		// sem nada no log da API — porque a requisição nunca sai da máquina.
		expect(baseUrlResolvida()).toBe("https://publica/v1");
	});

	it("cai para localhost:4000 quando nada está definido", () => {
		delete process.env.NEXT_PUBLIC_API_BASE_URL;
		delete process.env.API_BASE_URL;

		// É a porta do modo agregado (`pnpm dev:api`): o padrão serve o loop de
		// desenvolvimento sem exigir `.env.local` antes do primeiro `pnpm dev:web`.
		expect(baseUrlResolvida()).toBe("http://localhost:4000/v1");
	});
});
