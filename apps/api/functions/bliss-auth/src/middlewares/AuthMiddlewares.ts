/**
 * @module bliss-auth/middlewares/AuthMiddlewares
 *
 * Validação de entrada dos endpoints de autenticação.
 *
 * Os três endpoints são pequenos e compartilham a mesma forma de resposta, então
 * ficam num arquivo só — separá-los em três produziria mais cabeçalho do que
 * conteúdo. A nomenclatura por endpoint é preservada.
 */

import {
	AuthSessionSchema,
	AuthenticatedUserSchema,
	LoginPayloadSchema,
	LogoutPayloadSchema,
	RefreshPayloadSchema,
} from "@saude-bliss/contracts";
import { DefaultErroHandler, buildErrorResponseSchema, toJsonSchema } from "@saude-bliss/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const envelope = <T extends z.ZodTypeAny>(data: T) =>
	z.object({
		success: z.literal(true),
		data,
		message: z.string().optional(),
		requestId: z.string(),
		timestamp: z.string(),
	});

// --- POST /auth/login -------------------------------------------------------

export const LoginBodySchema = LoginPayloadSchema;
export type TLoginBody = z.infer<typeof LoginBodySchema>;
export type TLoginFastifyRequest = { Body: TLoginBody };

export const LoginMiddleware = async (
	req: FastifyRequest<TLoginFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.body = LoginBodySchema.parse(req.body);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "LoginMiddleware", action: "validate" });
	}
};

export const LoginSchema = {
	tags: ["auth"],
	summary: "Autentica e emite um par de tokens",
	description:
		"Troca e-mail e senha por um access token (JWT de curta duração, validado pelo bliss-authorizer) " +
		"e um refresh token opaco e revogável. Responde 401 genérico tanto para e-mail inexistente quanto " +
		"para senha errada, de propósito: distinguir os dois entregaria um oráculo de enumeração de contas.",
	body: toJsonSchema(LoginBodySchema),
	response: {
		200: toJsonSchema(envelope(AuthSessionSchema)),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		401: buildErrorResponseSchema(["INVALID_CREDENTIALS"]),
		403: buildErrorResponseSchema(["USER_INACTIVE"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};

// --- POST /auth/refresh -----------------------------------------------------

export const RefreshBodySchema = RefreshPayloadSchema;
export type TRefreshBody = z.infer<typeof RefreshBodySchema>;
export type TRefreshFastifyRequest = { Body: TRefreshBody };

export const RefreshMiddleware = async (
	req: FastifyRequest<TRefreshFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.body = RefreshBodySchema.parse(req.body);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "RefreshMiddleware", action: "validate" });
	}
};

export const RefreshSchema = {
	tags: ["auth"],
	summary: "Renova a sessão, rotacionando o refresh token",
	description:
		"Troca o refresh token por um par novo e revoga o anterior. Reapresentar um token já revogado " +
		"derruba **todas** as sessões do usuário — é a detecção de reuso da OAuth 2.0 Security BCP.",
	body: toJsonSchema(RefreshBodySchema),
	response: {
		200: toJsonSchema(envelope(AuthSessionSchema)),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		401: buildErrorResponseSchema(["INVALID_REFRESH_TOKEN"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};

// --- POST /auth/logout ------------------------------------------------------

export const LogoutBodySchema = LogoutPayloadSchema;
export type TLogoutBody = z.infer<typeof LogoutBodySchema>;
export type TLogoutFastifyRequest = { Body: TLogoutBody };

export const LogoutMiddleware = async (
	req: FastifyRequest<TLogoutFastifyRequest>,
	res: FastifyReply
): Promise<FastifyReply | void> => {
	try {
		req.body = LogoutBodySchema.parse(req.body);
	} catch (error) {
		return DefaultErroHandler(error, res, req, { module: "LogoutMiddleware", action: "validate" });
	}
};

export const LogoutSchema = {
	tags: ["auth"],
	summary: "Encerra a sessão",
	description: "Revoga o refresh token informado. Idempotente: revogar duas vezes não é erro.",
	body: toJsonSchema(LogoutBodySchema),
	response: {
		200: toJsonSchema(envelope(z.object({ revoked: z.literal(true) }))),
		400: buildErrorResponseSchema(["VALIDATION_ERROR"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};

// --- GET /auth/me -----------------------------------------------------------

export const MeSchema = {
	tags: ["auth"],
	summary: "Identidade de quem está chamando",
	description:
		"Resolve o usuário a partir do contexto anexado pelo bliss-authorizer. Não revalida o token: " +
		"a validação aconteceu na borda. O que se busca aqui é o estado **atual** do usuário, que pode " +
		"ter mudado desde a emissão do token.",
	response: {
		200: toJsonSchema(envelope(AuthenticatedUserSchema)),
		401: buildErrorResponseSchema(["INVALID_CREDENTIALS"]),
		503: buildErrorResponseSchema(["DATABASE_UNAVAILABLE"]),
	},
};
