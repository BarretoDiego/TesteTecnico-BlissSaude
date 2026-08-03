/**
 * Validação de entrada da autenticação.
 *
 * É a primeira barreira de uma superfície que recebe tentativa hostil por
 * definição. O que se verifica: entrada malformada é recusada **antes** de
 * qualquer trabalho caro, o e-mail chega normalizado ao service, e a senha
 * atravessa intacta — aparar uma senha mudaria silenciosamente a credencial.
 */

import { makeFastifyRequest, makeReply } from "@saude-bliss/testing";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
	LoginMiddleware,
	LoginSchema,
	LogoutMiddleware,
	LogoutSchema,
	MeSchema,
	RefreshMiddleware,
	RefreshSchema,
} from "../../src/middlewares/AuthMiddlewares";

const TOKEN = "refresh-token-com-tamanho-mais-que-suficiente";

function makeRequest(body: unknown) {
	const req = makeFastifyRequest() as unknown as FastifyRequest & { body: unknown };
	req.body = body;
	return req;
}

const credencial = { email: "daniel@saudebliss.test", password: "saudebliss123" };

describe("LoginMiddleware — entrada válida", () => {
	it("deixa passar sem responder", async () => {
		const reply = makeReply();

		const resultado = await LoginMiddleware(makeRequest(credencial) as never, reply.reply as FastifyReply);

		expect(resultado).toBeUndefined();
		expect(reply.statusCode).toBeUndefined();
	});

	it("normaliza o e-mail para minúsculas", async () => {
		const req = makeRequest({ ...credencial, email: "  DANIEL@SaudeBliss.TEST  " });

		await LoginMiddleware(req as never, makeReply().reply as FastifyReply);

		// Sem isso a mesma pessoa com grafias diferentes viraria contas distintas
		// na busca por e-mail.
		expect((req.body as { email: string }).email).toBe("daniel@saudebliss.test");
	});

	it("não altera a senha", async () => {
		const comEspacos = "  senha com espaços  ";
		const req = makeRequest({ ...credencial, password: comEspacos });

		await LoginMiddleware(req as never, makeReply().reply as FastifyReply);

		// Espaço é caractere legítimo de senha. Aparar mudaria a credencial e o
		// login falharia sem nenhuma explicação visível.
		expect((req.body as { password: string }).password).toBe(comEspacos);
	});

	it("aceita subendereçamento no e-mail", async () => {
		const reply = makeReply();

		await LoginMiddleware(
			makeRequest({ ...credencial, email: "conferencia+run1@saudebliss.test" }) as never,
			reply.reply as FastifyReply
		);

		expect(reply.statusCode).toBeUndefined();
	});
});

describe("LoginMiddleware — entrada inválida", () => {
	it.each([
		["corpo vazio", {}],
		["sem e-mail", { password: "saudebliss123" }],
		["sem senha", { email: "daniel@saudebliss.test" }],
		["e-mail malformado", { ...credencial, email: "não-é-email" }],
		["e-mail vazio", { ...credencial, email: "" }],
		["senha curta demais", { ...credencial, password: "1234567" }],
		["senha longa demais", { ...credencial, password: "a".repeat(201) }],
		["campo desconhecido", { ...credencial, roles: ["admin"] }],
		["senha numérica", { ...credencial, password: 12345678 }],
	])("responde 400 para %s", async (_caso, body) => {
		const reply = makeReply();

		await LoginMiddleware(makeRequest(body) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
		expect(reply.payload.error.code).toBe("VALIDATION_ERROR");
	});

	it("recusa senha curta antes de qualquer derivação", async () => {
		const reply = makeReply();

		// `scrypt` custa ~100ms por chamada. Barrar na borda é o que impede que
		// força bruta com senha inválida consuma CPU do serviço.
		await LoginMiddleware(makeRequest({ ...credencial, password: "123" }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});

	it("aponta os dois campos quando ambos estão errados", async () => {
		const reply = makeReply();

		await LoginMiddleware(makeRequest({ email: "x", password: "1" }) as never, reply.reply as FastifyReply);

		const campos = (reply.payload.error.details as Array<{ field: string }>).map((d) => d.field);
		expect(campos).toEqual(expect.arrayContaining(["email", "password"]));
	});

	it("recusa `admin: true` em vez de ignorar", async () => {
		const reply = makeReply();

		// `.strict()` faz o campo extra falhar alto — é a diferença entre recusar
		// uma tentativa de escalada e ignorá-la em silêncio.
		await LoginMiddleware(makeRequest({ ...credencial, admin: true }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});
});

describe("RefreshMiddleware", () => {
	it("deixa passar token com tamanho plausível", async () => {
		const reply = makeReply();

		await RefreshMiddleware(makeRequest({ refreshToken: TOKEN }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBeUndefined();
	});

	it.each([
		["corpo vazio", {}],
		["token curto", { refreshToken: "a".repeat(19) }],
		["token vazio", { refreshToken: "" }],
		["token numérico", { refreshToken: 12345678901234567890 }],
		["campo desconhecido", { refreshToken: TOKEN, userId: "x" }],
	])("responde 400 para %s", async (_caso, body) => {
		const reply = makeReply();

		await RefreshMiddleware(makeRequest(body) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});

	it("aceita exatamente 20 caracteres", async () => {
		const reply = makeReply();

		await RefreshMiddleware(makeRequest({ refreshToken: "a".repeat(20) }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBeUndefined();
	});

	it("recusa cedo o que não pode ter vindo do gerador", async () => {
		const reply = makeReply();

		// O token é aleatório de 256 bits. Qualquer coisa menor não veio de nós, e
		// negar aqui poupa uma consulta ao banco por tentativa.
		await RefreshMiddleware(makeRequest({ refreshToken: "curto" }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});
});

describe("LogoutMiddleware", () => {
	it("usa o mesmo contrato do refresh", async () => {
		const reply = makeReply();

		await LogoutMiddleware(makeRequest({ refreshToken: TOKEN }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBeUndefined();
	});

	it("responde 400 sem o token", async () => {
		const reply = makeReply();

		await LogoutMiddleware(makeRequest({}) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});

	it("recusa token curto", async () => {
		const reply = makeReply();

		await LogoutMiddleware(makeRequest({ refreshToken: "curto" }) as never, reply.reply as FastifyReply);

		expect(reply.statusCode).toBe(400);
	});
});

describe("schemas de documentação", () => {
	it("o login declara todos os desfechos que o cliente trata", () => {
		// 401 e 403 levam a telas diferentes: "tente de novo" e "procure o
		// administrador". Omitir um deixa quem integra sem saber que existe.
		expect(Object.keys(LoginSchema.response)).toEqual(expect.arrayContaining(["200", "400", "401", "403"]));
	});

	it("o refresh declara 401 para token inválido", () => {
		expect(Object.keys(RefreshSchema.response)).toEqual(expect.arrayContaining(["200", "400", "401"]));
	});

	it("o logout **não** declara 401, porque é idempotente", () => {
		// Revogar um token que já não existe responde 200. Devolver 401 aqui
		// vazaria quais tokens existem, sem nada que o cliente pudesse fazer de
		// diferente com a informação.
		expect(Object.keys(LogoutSchema.response)).toEqual(expect.arrayContaining(["200", "400"]));
		expect(Object.keys(LogoutSchema.response)).not.toContain("401");
	});

	it("o logout documenta a idempotência", () => {
		expect(LogoutSchema.description).toMatch(/idempotente/i);
	});

	it("todos declaram 503 para banco indisponível", () => {
		// 503 é retentável; 500 não. A distinção muda como o cliente e o alarme
		// reagem, e precisa estar documentada.
		for (const schema of [LoginSchema, RefreshSchema, LogoutSchema]) {
			expect(Object.keys(schema.response)).toContain("503");
		}
	});

	it("o /auth/me declara 200 e 401", () => {
		expect(Object.keys(MeSchema.response)).toEqual(expect.arrayContaining(["200", "401"]));
	});

	it("agrupam tudo sob a tag de autenticação", () => {
		for (const schema of [LoginSchema, RefreshSchema, LogoutSchema, MeSchema]) {
			expect(schema.tags).toEqual(["auth"]);
		}
	});

	it("descrevem o propósito de cada rota", () => {
		for (const schema of [LoginSchema, RefreshSchema, LogoutSchema, MeSchema]) {
			expect(schema.summary).toBeTruthy();
			expect(schema.description).toBeTruthy();
		}
	});

	it("o login explica por que o 401 é genérico", () => {
		// A descrição documenta uma decisão de segurança deliberada: sem ela,
		// alguém "melhoraria" a mensagem e criaria um oráculo de enumeração.
		expect(LoginSchema.description).toMatch(/enumera/i);
	});

	it("declaram corpo apenas onde há corpo", () => {
		expect(LoginSchema.body).toBeTruthy();
		expect(RefreshSchema.body).toBeTruthy();
		expect(LogoutSchema.body).toBeTruthy();
		expect(MeSchema).not.toHaveProperty("body");
	});
});
