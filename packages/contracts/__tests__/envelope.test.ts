/**
 * Envelope de resposta.
 *
 * É a forma que a API produz e que backoffice e automação desembrulham. Um
 * envelope que aceita o que não devia faz o consumidor tratar erro como sucesso
 * — a falha mais cara possível, porque é silenciosa.
 */

import {
	ApiErrorDetailSchema,
	ERROR_CODES,
	EnvelopeSchema,
	ErrorEnvelopeSchema,
	REQUEST_ID_HEADER,
	SuccessEnvelopeSchema,
	isSuccessEnvelope,
	type Envelope,
} from "../src/envelope";

const AGORA = "2026-08-03T12:00:00.000Z";

const sucesso = { success: true as const, data: { id: 1 }, requestId: "trace-1", timestamp: AGORA };
const erro = {
	success: false as const,
	error: { code: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada" },
	requestId: "trace-1",
	timestamp: AGORA,
};

describe("SuccessEnvelopeSchema", () => {
	it("aceita o envelope mínimo", () => {
		expect(SuccessEnvelopeSchema.safeParse(sucesso).success).toBe(true);
	});

	it("aceita mensagem opcional", () => {
		expect(SuccessEnvelopeSchema.safeParse({ ...sucesso, message: "Criada com sucesso" }).success).toBe(true);
	});

	it.each([
		["nulo", null],
		["lista", []],
		["texto", "algo"],
		["número", 0],
	])("aceita data do tipo %s", (_caso, data) => {
		// `data` é `unknown` de propósito: o envelope é genérico, e cada rota tipa
		// o próprio payload. Restringir aqui obrigaria um envelope por rota.
		expect(SuccessEnvelopeSchema.safeParse({ ...sucesso, data }).success).toBe(true);
	});

	it("exige success literalmente true", () => {
		expect(SuccessEnvelopeSchema.safeParse({ ...sucesso, success: false }).success).toBe(false);
		expect(SuccessEnvelopeSchema.safeParse({ ...sucesso, success: "true" }).success).toBe(false);
	});

	it("exige requestId", () => {
		// Sem ele o consumidor não tem como correlacionar a resposta com o log —
		// que é o motivo de o campo existir no envelope além do header.
		const { requestId: _ignorado, ...semTrace } = sucesso;

		expect(SuccessEnvelopeSchema.safeParse(semTrace).success).toBe(false);
	});

	it("exige timestamp em ISO 8601", () => {
		expect(SuccessEnvelopeSchema.safeParse({ ...sucesso, timestamp: "03/08/2026" }).success).toBe(false);
		expect(SuccessEnvelopeSchema.safeParse({ ...sucesso, timestamp: AGORA }).success).toBe(true);
	});
});

describe("ErrorEnvelopeSchema", () => {
	it("aceita o envelope de erro", () => {
		expect(ErrorEnvelopeSchema.safeParse(erro).success).toBe(true);
	});

	it("aceita detalhes de qualquer forma", () => {
		// Validação devolve lista de campos; erro de domínio devolve objeto. Os
		// dois precisam caber sem um schema por caso.
		const comLista = { ...erro, error: { ...erro.error, details: [{ field: "title", message: "curto" }] } };
		const comObjeto = { ...erro, error: { ...erro.error, details: { id: "abc" } } };

		expect(ErrorEnvelopeSchema.safeParse(comLista).success).toBe(true);
		expect(ErrorEnvelopeSchema.safeParse(comObjeto).success).toBe(true);
	});

	it("exige código e mensagem no erro", () => {
		expect(ErrorEnvelopeSchema.safeParse({ ...erro, error: { code: "X" } }).success).toBe(false);
		expect(ErrorEnvelopeSchema.safeParse({ ...erro, error: { message: "algo" } }).success).toBe(false);
	});

	it("exige success literalmente false", () => {
		expect(ErrorEnvelopeSchema.safeParse({ ...erro, success: true }).success).toBe(false);
	});

	it("carrega requestId também no erro", () => {
		// Redundância deliberada: correlacionar com o log importa mais no erro do
		// que no sucesso, e nem todo cliente expõe header de resposta com
		// facilidade.
		expect(ErrorEnvelopeSchema.parse(erro).requestId).toBe("trace-1");
	});
});

describe("EnvelopeSchema — união discriminada", () => {
	it("aceita os dois lados", () => {
		expect(EnvelopeSchema.safeParse(sucesso).success).toBe(true);
		expect(EnvelopeSchema.safeParse(erro).success).toBe(true);
	});

	it("decide pelo discriminante, e ignora campos do outro lado", () => {
		// `success` é o único campo que decide. Um envelope de sucesso com `error`
		// junto é aceito como sucesso — o campo extra é descartado no parse.
		const misturado = EnvelopeSchema.parse({ ...sucesso, error: erro.error });

		expect(misturado.success).toBe(true);
		expect(misturado).not.toHaveProperty("error");
	});

	it("aceita sucesso sem data, porque `z.unknown()` é opcional no Zod 3", () => {
		// Vale registrar em vez de assumir o contrário: `data: z.unknown()` não
		// exige a chave. Na prática a API sempre a preenche, e o consumidor tipa o
		// payload por rota — mas quem ler o schema não deve concluir que a
		// ausência seria recusada aqui.
		expect(EnvelopeSchema.safeParse({ success: true, requestId: "x", timestamp: AGORA }).success).toBe(true);
	});

	it("recusa erro sem o objeto `error`", () => {
		// O lado do erro **é** estrito: sem `error` não há o que mostrar ao
		// usuário nem código para o cliente ramificar.
		expect(EnvelopeSchema.safeParse({ success: false, requestId: "x", timestamp: AGORA }).success).toBe(false);
	});

	it("recusa envelope sem o discriminante", () => {
		expect(EnvelopeSchema.safeParse({ data: {}, requestId: "x", timestamp: AGORA }).success).toBe(false);
	});
});

describe("isSuccessEnvelope", () => {
	it("distingue os dois lados", () => {
		expect(isSuccessEnvelope(sucesso as Envelope<unknown>)).toBe(true);
		expect(isSuccessEnvelope(erro as Envelope<unknown>)).toBe(false);
	});

	it("estreita o tipo para o consumidor", () => {
		const envelope: Envelope<{ id: number }> = sucesso;

		// O valor do guard é o estreitamento: sem ele o consumidor faria cast, e o
		// compilador deixaria de avisar quando o envelope mudasse.
		if (isSuccessEnvelope(envelope)) {
			expect(envelope.data.id).toBe(1);
		} else {
			throw new Error("deveria ter sido reconhecido como sucesso");
		}
	});
});

describe("ERROR_CODES", () => {
	it("não tem duplicatas", () => {
		expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
	});

	it("cobre os desfechos que o cliente trata de forma diferente", () => {
		// Cada um destes leva o backoffice a uma reação distinta: reexibir o
		// formulário, mostrar 404, pedir login de novo, ou oferecer nova tentativa.
		for (const codigo of [
			"VALIDATION_ERROR",
			"REQUEST_NOT_FOUND",
			"INVALID_CREDENTIALS",
			"DATABASE_UNAVAILABLE",
			"INTERNAL_ERROR",
		]) {
			expect(ERROR_CODES).toContain(codigo);
		}
	});

	it("usa SCREAMING_SNAKE_CASE em todos", () => {
		for (const codigo of ERROR_CODES) expect(codigo).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
	});
});

describe("ApiErrorDetailSchema", () => {
	it("aceita detalhes ausentes", () => {
		expect(ApiErrorDetailSchema.safeParse({ code: "X", message: "y" }).success).toBe(true);
	});

	it("não restringe o código a um enum", () => {
		// Deliberado: o consumidor precisa desembrulhar respostas de uma API mais
		// nova sem quebrar. Quem valida contra o catálogo é a API, na origem.
		expect(ApiErrorDetailSchema.safeParse({ code: "CODIGO_FUTURO", message: "y" }).success).toBe(true);
	});
});

describe("REQUEST_ID_HEADER", () => {
	it("é minúsculo", () => {
		// Header HTTP é case-insensitive, mas o Fastify e o API Gateway normalizam
		// para minúsculo — comparar com outra grafia falharia silenciosamente.
		expect(REQUEST_ID_HEADER).toBe(REQUEST_ID_HEADER.toLowerCase());
		expect(REQUEST_ID_HEADER).toBe("x-request-id");
	});
});
