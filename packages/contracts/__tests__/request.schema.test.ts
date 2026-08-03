/**
 * Schemas do domínio de solicitações.
 *
 * São a fronteira de entrada da API: o que passa daqui chega ao banco. Os testes
 * miram as bordas — limites exatos, normalização e o que precisa ser **recusado**
 * —, porque é onde um schema permissivo produz dado sujo que nenhuma camada
 * posterior consegue distinguir de dado legítimo.
 */

import {
	ActorSchema,
	CreateRequestPayloadSchema,
	ListRequestsQueryPayloadSchema,
	RequestDescriptionSchema,
	RequestIdParamsSchema,
	RequestStatusFilterSchema,
	RequestTitleSchema,
	ReviewRequestPayloadSchema,
} from "../src/request.schema";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Payload válido mínimo — cada teste altera só o campo sob exame. */
const criacaoValida = {
	title: "Beneficiária sem acesso ao aplicativo",
	description: "Login retorna erro após a troca de senha pelo portal web.",
	priority: "high" as const,
	createdBy: "ana.souza@saudebliss.test",
};

describe("ActorSchema", () => {
	it("normaliza para minúsculas", () => {
		// É chave de filtro (`?createdBy=`). Sem normalizar, "Ana@x.com" e
		// "ana@x.com" viram dois solicitantes distintos na listagem.
		expect(ActorSchema.parse("Ana.Souza@SaudeBliss.TEST")).toBe("ana.souza@saudebliss.test");
	});

	it("remove espaços nas pontas antes de validar", () => {
		expect(ActorSchema.parse("  ana@saudebliss.test  ")).toBe("ana@saudebliss.test");
	});

	it.each([
		["sem arroba", "ana.souza"],
		["sem domínio", "ana@"],
		["sem usuário", "@saudebliss.test"],
		["com espaço no meio", "ana souza@saudebliss.test"],
		["vazio", ""],
	])("recusa %s", (_caso, valor) => {
		expect(ActorSchema.safeParse(valor).success).toBe(false);
	});

	it("recusa acima de 160 caracteres", () => {
		const longo = `${"a".repeat(150)}@saudebliss.test`;

		expect(longo.length).toBeGreaterThan(160);
		expect(ActorSchema.safeParse(longo).success).toBe(false);
	});

	it("recusa tipo que não seja string", () => {
		for (const valor of [42, null, undefined, {}, []]) {
			expect(ActorSchema.safeParse(valor).success).toBe(false);
		}
	});
});

describe("RequestTitleSchema", () => {
	it.each([
		["exatamente 3 caracteres", "abc", true],
		["exatamente 140 caracteres", "a".repeat(140), true],
		["2 caracteres", "ab", false],
		["141 caracteres", "a".repeat(141), false],
	])("%s → %s", (_caso, valor, aceito) => {
		// Os limites são testados no valor exato, e não em "curto" e "longo": é a
		// fronteira que erra em implementação, não o meio do intervalo.
		expect(RequestTitleSchema.safeParse(valor).success).toBe(aceito);
	});

	it("apara antes de medir o comprimento", () => {
		// Sem o trim antes, "  ab  " passaria pelo mínimo de 3 por causa dos
		// espaços — e o título gravado teria 2 caracteres úteis.
		expect(RequestTitleSchema.safeParse("  ab  ").success).toBe(false);
		expect(RequestTitleSchema.parse("  abc  ")).toBe("abc");
	});

	it("traz mensagem específica, e não a genérica do Zod", () => {
		const resultado = RequestTitleSchema.safeParse("ab");

		// A mensagem chega ao formulário do backoffice; "String must contain at
		// least 3 character(s)" não ajudaria quem está preenchendo.
		expect(resultado.success).toBe(false);
		if (!resultado.success) expect(resultado.error.issues[0]!.message).toMatch(/Título/);
	});
});

describe("RequestDescriptionSchema", () => {
	it.each([
		["exatamente 10 caracteres", "a".repeat(10), true],
		["exatamente 5000 caracteres", "a".repeat(5000), true],
		["9 caracteres", "a".repeat(9), false],
		["5001 caracteres", "a".repeat(5001), false],
	])("%s → %s", (_caso, valor, aceito) => {
		expect(RequestDescriptionSchema.safeParse(valor).success).toBe(aceito);
	});

	it("preserva quebras de linha", () => {
		const texto = "Primeira linha.\nSegunda linha.";

		// O detalhe renderiza com `whitespace-pre-wrap`; normalizar aqui destruiria
		// a formatação que a pessoa escreveu.
		expect(RequestDescriptionSchema.parse(texto)).toBe(texto);
	});
});

describe("CreateRequestPayloadSchema", () => {
	it("aceita o payload completo", () => {
		expect(CreateRequestPayloadSchema.parse(criacaoValida)).toEqual(criacaoValida);
	});

	it("normaliza o solicitante junto com o resto", () => {
		const parsed = CreateRequestPayloadSchema.parse({ ...criacaoValida, createdBy: "ANA@SaudeBliss.test" });

		expect(parsed.createdBy).toBe("ana@saudebliss.test");
	});

	it.each(["low", "medium", "high", "critical"])("aceita a prioridade %s", (priority) => {
		expect(CreateRequestPayloadSchema.safeParse({ ...criacaoValida, priority }).success).toBe(true);
	});

	it.each([
		["prioridade inventada", { priority: "urgentíssima" }],
		["prioridade em maiúscula", { priority: "HIGH" }],
		["prioridade numérica", { priority: 1 }],
	])("recusa %s", (_caso, override) => {
		expect(CreateRequestPayloadSchema.safeParse({ ...criacaoValida, ...override }).success).toBe(false);
	});

	it("recusa status no corpo", () => {
		// `status` é dado do servidor: toda solicitação nasce `open`. Aceitá-lo aqui
		// deixaria o cliente abrir uma solicitação já conferida.
		const resultado = CreateRequestPayloadSchema.safeParse({ ...criacaoValida, status: "reviewed" });

		expect(resultado.success).toBe(false);
	});

	it("recusa campo desconhecido em vez de ignorá-lo", () => {
		// `.strict()` faz o payload falhar alto. Ignorar em silêncio esconderia
		// erro de digitação num campo que o cliente achava estar enviando.
		expect(CreateRequestPayloadSchema.safeParse({ ...criacaoValida, prioridade: "alta" }).success).toBe(false);
	});

	it.each(["title", "description", "priority", "createdBy"])("exige o campo %s", (campo) => {
		const payload: Record<string, unknown> = { ...criacaoValida };
		delete payload[campo];

		expect(CreateRequestPayloadSchema.safeParse(payload).success).toBe(false);
	});

	it("relata todos os campos inválidos de uma vez", () => {
		const resultado = CreateRequestPayloadSchema.safeParse({
			title: "ab",
			description: "curta",
			priority: "inventada",
			createdBy: "não-é-email",
		});

		// Devolver um problema por vez faria a pessoa corrigir o formulário em
		// quatro rodadas.
		expect(resultado.success).toBe(false);
		if (!resultado.success) expect(resultado.error.issues.length).toBeGreaterThanOrEqual(4);
	});
});

describe("ReviewRequestPayloadSchema", () => {
	const conferenciaValida = { reviewedBy: "daniel@saudebliss.test", status: "reviewed" as const };

	it.each(["reviewed", "rejected"])("aceita o desfecho %s", (status) => {
		expect(ReviewRequestPayloadSchema.safeParse({ ...conferenciaValida, status }).success).toBe(true);
	});

	it.each(["open", "in_review"])("recusa o status intermediário %s", (status) => {
		// Conferir é decidir. `in_review` é estado de trabalho, não desfecho — e a
		// rota de conferência não deve conseguir devolver a solicitação à fila.
		expect(ReviewRequestPayloadSchema.safeParse({ ...conferenciaValida, status }).success).toBe(false);
	});

	it("aceita observação opcional", () => {
		const parsed = ReviewRequestPayloadSchema.parse({ ...conferenciaValida, note: "Conferido por telefone." });

		expect(parsed.note).toBe("Conferido por telefone.");
	});

	it("recusa observação acima de 500 caracteres", () => {
		expect(
			ReviewRequestPayloadSchema.safeParse({ ...conferenciaValida, note: "a".repeat(501) }).success
		).toBe(false);
	});

	it("apara a observação", () => {
		expect(ReviewRequestPayloadSchema.parse({ ...conferenciaValida, note: "  ok  " }).note).toBe("ok");
	});

	it("recusa campo desconhecido", () => {
		expect(ReviewRequestPayloadSchema.safeParse({ ...conferenciaValida, reviewedAt: "hoje" }).success).toBe(false);
	});

	it("traz mensagem própria para status inválido", () => {
		const resultado = ReviewRequestPayloadSchema.safeParse({ ...conferenciaValida, status: "arquivada" });

		expect(resultado.success).toBe(false);
		if (!resultado.success) expect(resultado.error.issues[0]!.message).toMatch(/reviewed.*rejected/);
	});
});

describe("RequestStatusFilterSchema", () => {
	it("aceita um status só e devolve lista de um", () => {
		// A saída é sempre lista: o repositório usa `inArray`, e um formato só
		// evita ramo condicional entre "um" e "vários".
		expect(RequestStatusFilterSchema.parse("open")).toEqual(["open"]);
	});

	it("aceita vários separados por vírgula", () => {
		expect(RequestStatusFilterSchema.parse("open,in_review")).toEqual(["open", "in_review"]);
	});

	it("tolera espaço em volta das vírgulas", () => {
		expect(RequestStatusFilterSchema.parse(" open , in_review ")).toEqual(["open", "in_review"]);
	});

	it("ignora vírgulas sobrando", () => {
		expect(RequestStatusFilterSchema.parse("open,,in_review,")).toEqual(["open", "in_review"]);
	});

	it.each([
		["status inventado", "arquivada"],
		["um inválido no meio de válidos", "open,arquivada,reviewed"],
		["string vazia", ""],
		["só vírgulas", ",,,"],
	])("recusa %s", (_caso, valor) => {
		// Aceitar em silêncio o que não existe devolveria um subconjunto e pareceria
		// funcionar — o pior desfecho para um filtro digitado errado.
		expect(RequestStatusFilterSchema.safeParse(valor).success).toBe(false);
	});

	it("nomeia os valores aceitos na mensagem de erro", () => {
		const resultado = RequestStatusFilterSchema.safeParse("arquivada");

		expect(resultado.success).toBe(false);
		if (!resultado.success) expect(resultado.error.issues[0]!.message).toMatch(/open.*in_review.*reviewed.*rejected/);
	});
});

describe("ListRequestsQueryPayloadSchema", () => {
	it("aplica os defaults de paginação", () => {
		expect(ListRequestsQueryPayloadSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
	});

	it("converte página e tamanho vindos como texto", () => {
		// Query string sempre chega como texto; sem `coerce` o filtro só
		// funcionaria em chamada programática.
		expect(ListRequestsQueryPayloadSchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
			page: 3,
			pageSize: 50,
		});
	});

	it.each([
		["página zero", { page: "0" }],
		["página negativa", { page: "-1" }],
		["página fracionária", { page: "1.5" }],
		["página não numérica", { page: "abc" }],
	])("recusa %s", (_caso, query) => {
		expect(ListRequestsQueryPayloadSchema.safeParse(query).success).toBe(false);
	});

	it("aceita o teto de 100 por página", () => {
		expect(ListRequestsQueryPayloadSchema.parse({ pageSize: "100" }).pageSize).toBe(100);
	});

	it("recusa acima de 100 por página", () => {
		// Sem o teto, `?pageSize=100000` vira table scan que esgota o pool de
		// conexões da Lambda.
		expect(ListRequestsQueryPayloadSchema.safeParse({ pageSize: "101" }).success).toBe(false);
	});

	it("recusa tamanho de página zero", () => {
		expect(ListRequestsQueryPayloadSchema.safeParse({ pageSize: "0" }).success).toBe(false);
	});

	it("normaliza o solicitante do filtro", () => {
		expect(ListRequestsQueryPayloadSchema.parse({ createdBy: "ANA@X.TEST" }).createdBy).toBe("ana@x.test");
	});

	it("combina todos os filtros", () => {
		const parsed = ListRequestsQueryPayloadSchema.parse({
			createdBy: "ana@x.test",
			status: "open,in_review",
			priority: "high",
			page: "2",
			pageSize: "10",
		});

		expect(parsed).toEqual({
			createdBy: "ana@x.test",
			status: ["open", "in_review"],
			priority: "high",
			page: 2,
			pageSize: 10,
		});
	});

	it("recusa filtro desconhecido", () => {
		// Sem `.strict()`, `?statuss=open` seria ignorado e a listagem devolveria
		// tudo — parecendo que o filtro não funciona.
		expect(ListRequestsQueryPayloadSchema.safeParse({ statuss: "open" }).success).toBe(false);
	});
});

describe("RequestIdParamsSchema", () => {
	it("aceita UUID válido", () => {
		expect(RequestIdParamsSchema.parse({ id: UUID })).toEqual({ id: UUID });
	});

	it.each([
		["texto solto", "nao-e-uuid"],
		["número", "12345"],
		["UUID truncado", UUID.slice(0, 20)],
		["vazio", ""],
	])("recusa %s", (_caso, id) => {
		// Deixar passar levaria o valor ao Postgres, que responderia erro de tipo —
		// um 500 no lugar de um 400.
		expect(RequestIdParamsSchema.safeParse({ id }).success).toBe(false);
	});

	it("recusa parâmetro extra na rota", () => {
		expect(RequestIdParamsSchema.safeParse({ id: UUID, extra: "x" }).success).toBe(false);
	});
});
