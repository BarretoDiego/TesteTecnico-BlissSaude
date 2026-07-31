/**
 * @module contracts/auth.schema
 *
 * Contratos de autenticação.
 *
 * Separação que vale explicitar: **`bliss-auth` autentica, `bliss-authorizer`
 * autoriza.** O primeiro troca credencial por token; o segundo valida o token na
 * borda do API Gateway. São serviços distintos porque têm perfis opostos — o de
 * autenticação é chamado uma vez por sessão e faz trabalho caro de propósito
 * (derivação de senha); o authorizer entra no caminho de toda requisição e
 * precisa ser barato.
 */

import { z } from "zod";

/** Papéis reconhecidos pelo sistema. */
export const USER_ROLES = ["admin", "reviewer", "requester"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const UserRoleSchema = z.enum(USER_ROLES);

export const USER_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
	admin: "Administrador",
	reviewer: "Conferente",
	requester: "Solicitante",
};

export const EmailSchema = z
	.string({ required_error: "Informe o e-mail" })
	.trim()
	.max(160, "E-mail deve ter no máximo 160 caracteres")
	.email("Informe um e-mail válido")
	.toLowerCase();

/**
 * Senha de entrada.
 *
 * Comprimento mínimo de 8 e teto de 200. O teto não é cosmético: a derivação da
 * senha custa proporcional ao tamanho da entrada, então aceitar uma senha de
 * megabytes é um vetor de negação de serviço barato de explorar.
 */
export const PasswordSchema = z
	.string({ required_error: "Informe a senha" })
	.min(8, "Senha deve ter ao menos 8 caracteres")
	.max(200, "Senha deve ter no máximo 200 caracteres");

// -----------------------------------------------------------------------------
// Entrada
// -----------------------------------------------------------------------------

export const LoginPayloadSchema = z
	.object({
		email: EmailSchema,
		password: PasswordSchema,
	})
	.strict();
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

export const RefreshPayloadSchema = z
	.object({
		refreshToken: z.string({ required_error: "Informe o refresh token" }).min(20, "Refresh token inválido"),
	})
	.strict();
export type RefreshPayload = z.infer<typeof RefreshPayloadSchema>;

export const LogoutPayloadSchema = RefreshPayloadSchema;
export type LogoutPayload = z.infer<typeof LogoutPayloadSchema>;

// -----------------------------------------------------------------------------
// Saída
// -----------------------------------------------------------------------------

/** Identidade pública. Nunca carrega hash de senha. */
export const AuthenticatedUserSchema = z.object({
	id: z.string().uuid(),
	email: z.string(),
	name: z.string(),
	roles: z.array(UserRoleSchema),
});
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const AuthSessionSchema = z.object({
	/** JWT de curta duração. É o que o authorizer valida. */
	accessToken: z.string(),
	/** Segundos até o access token expirar — o cliente renova antes disso. */
	expiresIn: z.number().int(),
	tokenType: z.literal("Bearer"),
	/**
	 * Token opaco de longa duração, trocável por um novo par.
	 *
	 * Opaco, e não um segundo JWT, de propósito: precisa ser revogável, e um JWT
	 * só deixa de valer quando expira. Este é guardado com hash no banco, então
	 * revogar é apagar uma linha.
	 */
	refreshToken: z.string(),
	user: AuthenticatedUserSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;
