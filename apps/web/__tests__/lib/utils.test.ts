/**
 * Utilitários de apresentação.
 *
 * Pequenos, mas usados em toda tela: `cn` decide qual classe vence quando duas
 * conflitam, e `formatDateTime` é o único lugar que converte instante em texto.
 * Uma regressão em qualquer um aparece em toda parte de uma vez.
 */

import { cn, formatDateTime } from "~/lib/utils";

describe("cn", () => {
	it("junta classes", () => {
		expect(cn("px-2", "text-sm")).toBe("px-2 text-sm");
	});

	it("resolve conflito do Tailwind mantendo a última", () => {
		// Sem o `twMerge`, as duas sairiam na string e o resultado dependeria da
		// ordem no CSS gerado — comportamento diferente entre build e dev.
		expect(cn("p-2", "p-4")).toBe("p-4");
	});

	it("resolve conflito em eixos específicos", () => {
		expect(cn("px-2", "px-4")).toBe("px-4");
		expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
	});

	it("preserva classes que não conflitam", () => {
		expect(cn("p-2", "text-sm", "rounded")).toBe("p-2 text-sm rounded");
	});

	it("aceita condicionais", () => {
		expect(cn("base", false && "escondida", "visivel")).toBe("base visivel");
	});

	it("aceita objeto de condições", () => {
		expect(cn({ ativo: true, inativo: false })).toBe("ativo");
	});

	it("aceita lista", () => {
		expect(cn(["px-2", "py-1"])).toBe("px-2 py-1");
	});

	it("ignora nulo e indefinido", () => {
		expect(cn("base", null, undefined, "")).toBe("base");
	});

	it("devolve string vazia sem argumentos", () => {
		expect(cn()).toBe("");
	});

	it("permite sobrescrever a classe de um componente", () => {
		// É o caso de uso real: o componente traz um padrão e quem o usa passa uma
		// variante que precisa vencer.
		const padrao = "rounded-md bg-slate-900 px-4 py-2";

		expect(cn(padrao, "bg-rose-600")).toContain("bg-rose-600");
		expect(cn(padrao, "bg-rose-600")).not.toContain("bg-slate-900");
	});
});

describe("formatDateTime", () => {
	it("formata no padrão brasileiro", () => {
		const texto = formatDateTime("2026-08-03T14:30:00.000Z");

		// Formato curto: dd/mm/aa, hh:mm. O teste afirma a forma, não o fuso — que
		// depende de onde o browser roda.
		expect(texto).toMatch(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/);
	});

	it("é estável para o mesmo instante", () => {
		const iso = "2026-08-03T14:30:00.000Z";

		expect(formatDateTime(iso)).toBe(formatDateTime(iso));
	});

	it("distingue instantes diferentes", () => {
		expect(formatDateTime("2026-08-03T14:30:00.000Z")).not.toBe(formatDateTime("2026-08-04T14:30:00.000Z"));
	});

	it("aceita ISO sem milissegundos", () => {
		// É a forma que o Postgres devolve em algumas colunas.
		expect(formatDateTime("2026-08-03T14:30:00Z")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
	});

	it("devolve texto de data inválida em vez de lançar", () => {
		// Uma data corrompida no banco não pode derrubar a tabela inteira: melhor
		// uma célula estranha do que uma página em branco.
		expect(() => formatDateTime("não é data")).not.toThrow();
		expect(formatDateTime("não é data")).toMatch(/Invalid Date|Data inválida/i);
	});
});
