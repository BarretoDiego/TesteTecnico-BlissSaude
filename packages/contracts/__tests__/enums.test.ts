/**
 * Enums e transições do domínio.
 *
 * Os arrays daqui alimentam três consumidores que precisam concordar: o `pgEnum`
 * do Drizzle, os `z.enum` de validação e os filtros do backoffice. Os testes
 * cobrem a máquina de estados e a completude dos mapas de rótulo — que é onde um
 * valor novo entra e alguém esquece de atualizar o resto.
 */

import {
	PENDING_REVIEW_STATUSES,
	REQUEST_EVENT_TYPES,
	REQUEST_EVENT_TYPE_LABELS,
	REQUEST_PRIORITIES,
	REQUEST_PRIORITY_LABELS,
	REQUEST_STATUSES,
	REQUEST_STATUS_LABELS,
	REQUEST_STATUS_TRANSITIONS,
	canTransition,
	type RequestStatus,
} from "../src/enums";

describe("completude dos rótulos", () => {
	// Os três pares têm tipos de chave diferentes, e o `it.each` os uniria numa
	// união que o TypeScript recusa indexar. `Record<string, string>` na borda do
	// teste é a forma honesta: a checagem de completude é sobre os **dados**.
	it.each([
		["status", REQUEST_STATUSES as readonly string[], REQUEST_STATUS_LABELS as Record<string, string>],
		["prioridade", REQUEST_PRIORITIES as readonly string[], REQUEST_PRIORITY_LABELS as Record<string, string>],
		["tipo de evento", REQUEST_EVENT_TYPES as readonly string[], REQUEST_EVENT_TYPE_LABELS as Record<string, string>],
	])("todo valor de %s tem rótulo, e nenhum rótulo sobra", (_nome, valores, rotulos) => {
		// As duas direções importam. Faltando: o valor cru aparece na tela.
		// Sobrando: alguém removeu do enum e o rótulo virou código morto.
		for (const valor of valores) expect(rotulos[valor]).toBeTruthy();
		expect(Object.keys(rotulos).sort()).toEqual([...valores].sort());
	});

	it("nenhum rótulo é igual ao valor cru", () => {
		// Rótulo idêntico ao identificador sugere que ninguém o traduziu de fato.
		for (const status of REQUEST_STATUSES) expect(REQUEST_STATUS_LABELS[status]).not.toBe(status);
		for (const tipo of REQUEST_EVENT_TYPES) expect(REQUEST_EVENT_TYPE_LABELS[tipo]).not.toBe(tipo);
	});
});

describe("REQUEST_STATUS_TRANSITIONS", () => {
	it("declara transições para todo status", () => {
		expect(Object.keys(REQUEST_STATUS_TRANSITIONS).sort()).toEqual([...REQUEST_STATUSES].sort());
	});

	it("só aponta para status que existem", () => {
		for (const destinos of Object.values(REQUEST_STATUS_TRANSITIONS)) {
			for (const destino of destinos) expect(REQUEST_STATUSES).toContain(destino);
		}
	});

	it.each(["reviewed", "rejected"] as const)("%s é terminal", (status) => {
		// Conferida é decisão final. Permitir saída daqui reabriria uma solicitação
		// já decidida, e a trilha de auditoria passaria a contar duas histórias.
		expect(REQUEST_STATUS_TRANSITIONS[status]).toEqual([]);
	});

	it("nenhum status transita para si mesmo", () => {
		for (const [origem, destinos] of Object.entries(REQUEST_STATUS_TRANSITIONS)) {
			expect(destinos).not.toContain(origem);
		}
	});

	it("todo status não-terminal alcança um desfecho", () => {
		// Um status do qual não se sai seria uma solicitação presa na fila para
		// sempre, sem nenhuma ação capaz de resolvê-la.
		for (const status of REQUEST_STATUSES) {
			if (REQUEST_STATUS_TRANSITIONS[status].length === 0) continue;
			const alcanca = REQUEST_STATUS_TRANSITIONS[status].some((s) => s === "reviewed" || s === "rejected");
			expect(alcanca).toBe(true);
		}
	});
});

describe("canTransition", () => {
	it.each([
		["open", "in_review", true],
		["open", "reviewed", true],
		["open", "rejected", true],
		["in_review", "reviewed", true],
		["in_review", "rejected", true],
		["in_review", "open", false],
		["in_review", "in_review", false],
		["reviewed", "open", false],
		["reviewed", "rejected", false],
		["rejected", "reviewed", false],
		["open", "open", false],
	] as const)("%s → %s = %s", (de, para, esperado) => {
		expect(canTransition(de, para)).toBe(esperado);
	});

	it("concorda com a tabela para toda combinação possível", () => {
		// Varre a matriz inteira: garante que a função não tem lógica própria além
		// de consultar a tabela — se tivesse, as duas divergiriam com o tempo.
		for (const de of REQUEST_STATUSES) {
			for (const para of REQUEST_STATUSES) {
				expect(canTransition(de, para)).toBe(REQUEST_STATUS_TRANSITIONS[de].includes(para));
			}
		}
	});
});

describe("PENDING_REVIEW_STATUSES", () => {
	it("contém apenas status que existem", () => {
		for (const status of PENDING_REVIEW_STATUSES) expect(REQUEST_STATUSES).toContain(status);
	});

	it("é exatamente o conjunto dos não-terminais", () => {
		// A fila de conferência é "o que ainda pode mudar". Divergir daqui faria a
		// fila esconder trabalho ou mostrar solicitação já decidida.
		const naoTerminais = REQUEST_STATUSES.filter((s) => REQUEST_STATUS_TRANSITIONS[s].length > 0);

		expect([...PENDING_REVIEW_STATUSES].sort()).toEqual([...naoTerminais].sort());
	});

	it("não inclui nenhum status terminal", () => {
		for (const status of PENDING_REVIEW_STATUSES) {
			expect(REQUEST_STATUS_TRANSITIONS[status as RequestStatus].length).toBeGreaterThan(0);
		}
	});
});

describe("estabilidade dos identificadores", () => {
	it("os valores persistidos não mudam sem migração", () => {
		// Estes literais estão gravados em `requests.status` no banco. Alterá-los
		// exige migração de dados — o teste existe para que a mudança seja
		// deliberada, e não um efeito colateral de refatoração.
		expect([...REQUEST_STATUSES]).toEqual(["open", "in_review", "reviewed", "rejected"]);
		expect([...REQUEST_PRIORITIES]).toEqual(["low", "medium", "high", "critical"]);
		expect([...REQUEST_EVENT_TYPES]).toEqual(["created", "status_changed", "reviewed"]);
	});

	it("prioridades estão em ordem crescente de urgência", () => {
		// A ordem é lida como escala pelo backoffice; embaralhá-la inverteria o
		// significado dos filtros sem nenhum erro visível.
		expect(REQUEST_PRIORITIES.indexOf("low")).toBeLessThan(REQUEST_PRIORITIES.indexOf("medium"));
		expect(REQUEST_PRIORITIES.indexOf("medium")).toBeLessThan(REQUEST_PRIORITIES.indexOf("high"));
		expect(REQUEST_PRIORITIES.indexOf("high")).toBeLessThan(REQUEST_PRIORITIES.indexOf("critical"));
	});
});
