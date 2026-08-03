/**
 * Logger estruturado.
 *
 * A garantia crítica: uma linha, um objeto JSON, `requestId` no nível raiz. É o
 * que permite `filter requestId = "..."` no CloudWatch Logs Insights sem
 * expressão de parse.
 */

import { BlissLogger } from "../../../src/utils/BlissLogger";
import { runWithRequestContext } from "../../../src/utils/requestContext";

function captureLog(fn: () => void, stream: "log" | "warn" | "error" = "log"): any {
	const spy = jest.spyOn(console, stream).mockImplementation(() => {});
	fn();
	const [line] = spy.mock.calls[0] ?? [];
	spy.mockRestore();
	return line ? JSON.parse(line as string) : undefined;
}

describe("BlissLogger", () => {
	it("emite uma única linha de JSON válido", () => {
		const entry = captureLog(() => new BlissLogger("debug").log("info", "Mod", "act", "mensagem"));

		expect(entry).toMatchObject({ level: "info", module: "Mod", action: "act", message: "mensagem" });
	});

	it("carimba o requestId do contexto no nível raiz", () => {
		const entry = captureLog(() =>
			runWithRequestContext({ requestId: "trace-xyz", startedAt: Date.now() }, () =>
				new BlissLogger("debug").log("info", "Mod", "act", "mensagem")
			)
		);

		// Nível raiz, não aninhado: é o que dispensa parse no Logs Insights.
		expect(entry.requestId).toBe("trace-xyz");
	});

	it("inclui timestamp ISO e duração da requisição", () => {
		const entry = captureLog(() =>
			runWithRequestContext({ requestId: "abc", startedAt: Date.now() - 50 }, () =>
				new BlissLogger("debug").log("info", "Mod", "act", "mensagem")
			)
		);

		expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		expect(entry.durationMs).toBeGreaterThanOrEqual(50);
	});

	it("mescla os parâmetros extras no objeto raiz", () => {
		const entry = captureLog(() =>
			new BlissLogger("debug").log("info", "Mod", "act", "msg", { id: 7, status: "open" })
		);

		expect(entry).toMatchObject({ id: 7, status: "open" });
	});

	it("serializa Error em vez de emitir um objeto vazio", () => {
		// `JSON.stringify(new Error("x"))` produz `{}` — perder a mensagem do erro
		// no log é o pior momento possível para perder informação.
		const entry = captureLog(() =>
			new BlissLogger("debug").log("info", "Mod", "act", "msg", { error: new Error("falhou feio") })
		);

		expect(entry.error).toMatchObject({ name: "Error", message: "falhou feio" });
	});

	it("inclui o stack do erro em ambiente local", () => {
		process.env.BLISS_ENV = "local";

		const entry = captureLog(() =>
			new BlissLogger("debug").log("info", "Mod", "act", "msg", { error: new Error("falhou") })
		);

		expect(entry.error.stack).toEqual(expect.any(String));
	});

	it("omite o stack fora do ambiente local", () => {
		process.env.BLISS_ENV = "prod";

		const entry = captureLog(() =>
			new BlissLogger("debug").log("info", "Mod", "act", "msg", { error: new Error("falhou") })
		);

		// Stack em log de produção expõe caminho de arquivo e estrutura interna
		// para qualquer pessoa com acesso ao CloudWatch.
		expect(entry.error).not.toHaveProperty("stack");
		expect(entry.error.message).toBe("falhou");

		process.env.BLISS_ENV = "local";
	});

	it("preserva valores não-Error dos parâmetros", () => {
		const entry = captureLog(() =>
			new BlissLogger("debug").log("info", "Mod", "act", "msg", { lista: [1, 2], nulo: null })
		);

		expect(entry).toMatchObject({ lista: [1, 2], nulo: null });
	});

	it("omite requestId e durationMs fora de uma requisição", () => {
		const entry = captureLog(() => new BlissLogger("debug").log("info", "Mod", "act", "msg"));

		// `JSON.stringify` descarta chaves com `undefined`, então uma linha emitida
		// por script de seed ou migration simplesmente não carrega correlação — e
		// não polui a consulta com `requestId: null`.
		expect(Object.keys(entry).sort()).toEqual(["action", "level", "message", "module", "timestamp"]);
	});

	it("descarta mensagens abaixo do nível configurado", () => {
		const spy = jest.spyOn(console, "log").mockImplementation(() => {});

		new BlissLogger("warn").log("debug", "Mod", "act", "não deve aparecer");

		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it.each([
		["error", "error"],
		["warn", "warn"],
		["info", "log"],
		["debug", "log"],
	] as const)("envia o nível %s para console.%s", (level, stream) => {
		const spy = jest.spyOn(console, stream).mockImplementation(() => {});

		new BlissLogger("debug").log(level, "Mod", "act", "msg");

		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});

/**
 * Nível padrão, quando o construtor não recebe um.
 *
 * `resolveDefaultLevel` roda como valor padrão do parâmetro, então lê o ambiente
 * a cada construção. O que se verifica é comportamento — qual linha sai — e não
 * o valor interno, que é privado de propósito.
 */
describe("BlissLogger — nível padrão", () => {
	const ORIGINAL = { ...process.env };

	afterEach(() => {
		process.env = { ...ORIGINAL };
	});

	/** `true` se uma chamada nesse nível chega ao console. */
	function emite(level: "debug" | "info"): boolean {
		const spy = jest.spyOn(console, "log").mockImplementation(() => {});
		new BlissLogger().log(level, "Mod", "act", "msg");
		const chamou = spy.mock.calls.length > 0;
		spy.mockRestore();
		return chamou;
	}

	it("respeita LOG_LEVEL quando é um nível conhecido", () => {
		process.env.LOG_LEVEL = "info";

		expect(emite("debug")).toBe(false);
		expect(emite("info")).toBe(true);
	});

	it("ignora LOG_LEVEL desconhecido em vez de quebrar", () => {
		process.env.LOG_LEVEL = "verboso-demais";
		process.env.BLISS_ENV = "local";

		// Valor inválido não pode derrubar a inicialização: o logger precisa
		// existir antes de qualquer coisa que saberia reportar o erro.
		expect(emite("debug")).toBe(true);
	});

	it("usa debug em ambiente local", () => {
		delete process.env.LOG_LEVEL;
		process.env.BLISS_ENV = "local";

		expect(emite("debug")).toBe(true);
	});

	it("usa info fora de ambiente local", () => {
		delete process.env.LOG_LEVEL;
		process.env.BLISS_ENV = "prod";

		// `debug` em produção multiplicaria o volume — e o custo — do CloudWatch
		// sem que ninguém tivesse pedido.
		expect(emite("debug")).toBe(false);
		expect(emite("info")).toBe(true);
	});

	it("cai para NODE_ENV quando BLISS_ENV não está definida", () => {
		delete process.env.LOG_LEVEL;
		delete process.env.BLISS_ENV;
		process.env.NODE_ENV = "test";

		// `BLISS_ENV` é nossa; `NODE_ENV` é a que a ferramenta define. Sem este
		// encadeamento, rodar sob Jest ou `next dev` cairia no ramo de produção e
		// esconderia justamente as linhas de debug que se está tentando ler.
		expect(emite("debug")).toBe(true);
	});

	it("assume ambiente local quando nenhuma das duas existe", () => {
		delete process.env.LOG_LEVEL;
		delete process.env.BLISS_ENV;
		delete process.env.NODE_ENV;

		// Sem variável nenhuma é máquina de quem está desenvolvendo, não produção:
		// o padrão precisa ser o verboso, que é o que se quer no primeiro `pnpm dev`.
		expect(emite("debug")).toBe(true);
	});

	it("cai para info quando o nível pedido não existe na tabela", () => {
		const spy = jest.spyOn(console, "log").mockImplementation(() => {});

		// Nível inventado chegando pelo construtor — configuração errada, ou um
		// nível novo adicionado ao tipo e esquecido na tabela de pesos. Sem o
		// fallback o peso mínimo viraria `undefined` e **toda** comparação de nível
		// daria falso: o serviço rodaria mudo, que é pior do que verboso demais.
		new BlissLogger("inexistente" as never).log("info", "Mod", "act", "msg");

		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
