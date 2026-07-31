/**
 * Contexto de requisição.
 *
 * O teste mais importante é o de isolamento entre contextos concorrentes: é
 * exatamente a falha que `enterWith` sozinho produz em container Lambda
 * reutilizado, e ela se manifesta como log com o `requestId` de outra pessoa.
 */

import {
	enterRequestContext,
	getElapsedMs,
	getRequestContext,
	getRequestId,
	runWithRequestContext,
} from "../../../src/utils/requestContext";

describe("runWithRequestContext", () => {
	it("expõe o contexto dentro do callback", () => {
		const result = runWithRequestContext({ requestId: "abc", startedAt: Date.now() }, () => getRequestId());

		expect(result).toBe("abc");
	});

	it("não vaza o contexto para fora do callback", () => {
		runWithRequestContext({ requestId: "abc", startedAt: Date.now() }, () => getRequestId());

		expect(getRequestId()).toBeUndefined();
	});

	it("mantém o contexto através de await", async () => {
		const result = await runWithRequestContext({ requestId: "async-1", startedAt: Date.now() }, async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return getRequestId();
		});

		expect(result).toBe("async-1");
	});

	it("isola contextos de execuções concorrentes", async () => {
		// A falha que este teste previne: dois requests em voo compartilharem o
		// store e um log sair carimbado com o requestId do outro.
		const run = (id: string, delay: number) =>
			runWithRequestContext({ requestId: id, startedAt: Date.now() }, async () => {
				await new Promise((resolve) => setTimeout(resolve, delay));
				return getRequestId();
			});

		const [first, second] = await Promise.all([run("req-1", 20), run("req-2", 1)]);

		expect(first).toBe("req-1");
		expect(second).toBe("req-2");
	});

	it("preserva os demais campos do contexto", () => {
		const context = { requestId: "abc", method: "POST", route: "/requests", startedAt: 1000 };

		const result = runWithRequestContext(context, () => getRequestContext());

		expect(result).toEqual(context);
	});
});

describe("enterRequestContext", () => {
	it("torna o contexto visível na mesma cadeia assíncrona", async () => {
		const result = await runWithRequestContext({ requestId: "externo", startedAt: Date.now() }, async () => {
			enterRequestContext({ requestId: "interno", startedAt: Date.now() });
			return getRequestId();
		});

		expect(result).toBe("interno");
	});
});

describe("getElapsedMs", () => {
	it("mede o tempo desde o início da requisição", () => {
		const elapsed = runWithRequestContext({ requestId: "abc", startedAt: Date.now() - 150 }, () => getElapsedMs());

		expect(elapsed).toBeGreaterThanOrEqual(150);
	});

	it("retorna undefined fora de uma requisição", () => {
		// Cenário real: scripts de seed e migration rodam sem contexto e não podem
		// quebrar por isso.
		expect(getElapsedMs()).toBeUndefined();
		expect(getRequestContext()).toBeUndefined();
	});
});
