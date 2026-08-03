/**
 * Contratos de autenticação.
 *
 * Schema de credencial é superfície de ataque: um limite ausente vira negação de
 * serviço, e um campo de saída generoso demais vira vazamento. Os testes cobrem
 * as duas direções — o que a entrada precisa recusar e o que a saída não pode
 * carregar.
 */

import {
	AuthSessionSchema,
	AuthenticatedUserSchema,
	EmailSchema,
	LoginPayloadSchema,
	LogoutPayloadSchema,
	PasswordSchema,
	RefreshPayloadSchema,
	USER_ROLES,
	USER_ROLE_LABELS,
	UserRoleSchema,
} from "../src/auth.schema";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("EmailSchema", () => {
	it("normaliza para minúsculas e apara", () => {
		expect(EmailSchema.parse("  Daniel.Morais@SaudeBliss.TEST ")).toBe("daniel.morais@saudebliss.test");
	});

	it("aceita subendereçamento com +", () => {
		// A automação semeia dados com `conferencia+<execução>@…`. Recusar isso
		// quebraria o isolamento entre execuções da suíte.
		expect(EmailSchema.parse("conferencia+abc123@saudebliss.test")).toBe("conferencia+abc123@saudebliss.test");
	});

	it.each([
		["sem arroba", "daniel"],
		["dois arrobas", "a@b@c.test"],
		["sem TLD", "daniel@localhost"],
		["vazio", ""],
		["só espaços", "   "],
	])("recusa %s", (_caso, valor) => {
		expect(EmailSchema.safeParse(valor).success).toBe(false);
	});

	it("recusa acima de 160 caracteres", () => {
		expect(EmailSchema.safeParse(`${"a".repeat(160)}@x.test`).success).toBe(false);
	});
});

describe("PasswordSchema", () => {
	it.each([
		["exatamente 8", "a".repeat(8), true],
		["exatamente 200", "a".repeat(200), true],
		["7 caracteres", "a".repeat(7), false],
		["201 caracteres", "a".repeat(201), false],
	])("%s → %s", (_caso, valor, aceito) => {
		expect(PasswordSchema.safeParse(valor).success).toBe(aceito);
	});

	it("não apara a senha", () => {
		// Espaço é caractere legítimo de senha. Aparar mudaria silenciosamente a
		// credencial e faria o login falhar sem explicação.
		expect(PasswordSchema.parse("  senha com espaço  ")).toBe("  senha com espaço  ");
	});

	it("aceita caracteres especiais e acentuação", () => {
		expect(PasswordSchema.safeParse("çãõ!@#$%¨&*()_+ áé").success).toBe(true);
	});

	it("recusa valor que não seja string", () => {
		for (const valor of [12345678, null, undefined, {}]) {
			expect(PasswordSchema.safeParse(valor).success).toBe(false);
		}
	});
});

describe("LoginPayloadSchema", () => {
	const valido = { email: "daniel@saudebliss.test", password: "saudebliss123" };

	it("aceita e normaliza", () => {
		expect(LoginPayloadSchema.parse({ ...valido, email: "DANIEL@SaudeBliss.test" }).email).toBe(
			"daniel@saudebliss.test"
		);
	});

	it.each(["email", "password"])("exige o campo %s", (campo) => {
		const payload: Record<string, unknown> = { ...valido };
		delete payload[campo];

		expect(LoginPayloadSchema.safeParse(payload).success).toBe(false);
	});

	it("recusa campo desconhecido", () => {
		// Tipicamente alguém tentando mandar `roles` ou `admin: true` junto.
		expect(LoginPayloadSchema.safeParse({ ...valido, roles: ["admin"] }).success).toBe(false);
	});

	it("recusa senha curta antes de qualquer consulta", () => {
		// A validação na borda evita derivar `scrypt` (~100ms) para uma entrada que
		// nunca poderia ser válida — o caminho barato de negar força bruta.
		expect(LoginPayloadSchema.safeParse({ ...valido, password: "123" }).success).toBe(false);
	});
});

describe("RefreshPayloadSchema", () => {
	const tokenValido = "a".repeat(43);

	it("aceita token com tamanho plausível", () => {
		expect(RefreshPayloadSchema.parse({ refreshToken: tokenValido }).refreshToken).toBe(tokenValido);
	});

	it("recusa token curto demais para ser aleatório de 256 bits", () => {
		// 20 caracteres é o piso: qualquer coisa menor não veio do gerador, e negar
		// cedo evita uma consulta ao banco por tentativa.
		expect(RefreshPayloadSchema.safeParse({ refreshToken: "a".repeat(19) }).success).toBe(false);
	});

	it("aceita exatamente 20 caracteres", () => {
		expect(RefreshPayloadSchema.safeParse({ refreshToken: "a".repeat(20) }).success).toBe(true);
	});

	it("recusa corpo vazio", () => {
		expect(RefreshPayloadSchema.safeParse({}).success).toBe(false);
	});

	it("recusa campo desconhecido", () => {
		expect(RefreshPayloadSchema.safeParse({ refreshToken: tokenValido, userId: UUID }).success).toBe(false);
	});

	it("logout usa exatamente o mesmo contrato", () => {
		// São o mesmo schema de propósito: revogar e renovar recebem o mesmo token,
		// e duplicar a definição deixaria os dois divergirem.
		expect(LogoutPayloadSchema.safeParse({ refreshToken: tokenValido }).success).toBe(true);
		expect(LogoutPayloadSchema.safeParse({ refreshToken: "curto" }).success).toBe(false);
	});
});

describe("UserRoleSchema", () => {
	it.each(USER_ROLES)("aceita o perfil %s", (role) => {
		expect(UserRoleSchema.safeParse(role).success).toBe(true);
	});

	it.each(["ADMIN", "superadmin", "", "administrador"])("recusa %p", (valor) => {
		expect(UserRoleSchema.safeParse(valor).success).toBe(false);
	});

	it("tem rótulo em PT-BR para todo perfil", () => {
		// Um perfil novo sem rótulo apareceria cru na tela. O teste falha no dia em
		// que alguém acrescenta ao enum e esquece do mapa.
		for (const role of USER_ROLES) {
			expect(USER_ROLE_LABELS[role]).toBeTruthy();
		}
		expect(Object.keys(USER_ROLE_LABELS)).toHaveLength(USER_ROLES.length);
	});
});

describe("AuthenticatedUserSchema", () => {
	const usuario = {
		id: UUID,
		email: "daniel@saudebliss.test",
		name: "Daniel Morais",
		roles: ["admin", "reviewer"],
	};

	it("aceita a identidade pública", () => {
		expect(AuthenticatedUserSchema.parse(usuario)).toEqual(usuario);
	});

	it("aceita lista de perfis vazia", () => {
		// Usuário sem perfil é estado legítimo: autenticado, sem autorização.
		expect(AuthenticatedUserSchema.safeParse({ ...usuario, roles: [] }).success).toBe(true);
	});

	it("recusa id que não seja UUID", () => {
		expect(AuthenticatedUserSchema.safeParse({ ...usuario, id: "123" }).success).toBe(false);
	});

	it("recusa perfil desconhecido na lista", () => {
		expect(AuthenticatedUserSchema.safeParse({ ...usuario, roles: ["admin", "root"] }).success).toBe(false);
	});

	it("descarta o hash de senha se ele aparecer", () => {
		// O schema não é `.strict()` aqui de propósito — é saída, não entrada —,
		// mas o `parse` só devolve os campos declarados. É a garantia de que um
		// campo a mais na linha do banco não vaza para o browser.
		const parsed = AuthenticatedUserSchema.parse({ ...usuario, passwordHash: "scrypt$32768$8$1$abc$def" });

		expect(parsed).not.toHaveProperty("passwordHash");
	});
});

describe("AuthSessionSchema", () => {
	const sessao = {
		accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinatura",
		expiresIn: 900,
		tokenType: "Bearer" as const,
		refreshToken: "a".repeat(43),
		user: { id: UUID, email: "daniel@saudebliss.test", name: "Daniel Morais", roles: ["admin"] },
	};

	it("aceita a sessão completa", () => {
		expect(AuthSessionSchema.parse(sessao)).toEqual(sessao);
	});

	it("fixa o tipo do token em Bearer", () => {
		// Literal, e não string: o cliente monta o header a partir disso, e um
		// valor diferente produziria `Authorization` que o authorizer recusa.
		expect(AuthSessionSchema.safeParse({ ...sessao, tokenType: "Basic" }).success).toBe(false);
	});

	it("exige expiração inteira", () => {
		expect(AuthSessionSchema.safeParse({ ...sessao, expiresIn: 900.5 }).success).toBe(false);
	});

	it.each(["accessToken", "refreshToken", "user", "expiresIn"])("exige o campo %s", (campo) => {
		const payload: Record<string, unknown> = { ...sessao };
		delete payload[campo];

		expect(AuthSessionSchema.safeParse(payload).success).toBe(false);
	});
});
