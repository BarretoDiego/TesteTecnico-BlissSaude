/**
 * @module api/errors/catalog
 *
 * Catálogo de erros: código → status HTTP + mensagem PT-BR.
 *
 * Centralizar aqui garante que o mesmo código sempre produza o mesmo status —
 * o modo de falha clássico é `REQUEST_NOT_FOUND` virar 404 em um handler e 400
 * em outro. Também dá ao consumidor um contrato estável: dá para tratar
 * `error.code` em vez de casar substring de mensagem.
 */

import type { ErrorCode } from "@saude-bliss/contracts";

export interface ErrorDefinition {
	httpStatus: number;
	message: string;
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorDefinition>> = {
	VALIDATION_ERROR: {
		httpStatus: 400,
		message: "Os dados enviados são inválidos",
	},
	REQUEST_NOT_FOUND: {
		httpStatus: 404,
		message: "Solicitação não encontrada",
	},
	INVALID_STATUS_TRANSITION: {
		httpStatus: 409,
		message: "A transição de status solicitada não é permitida",
	},
	REQUEST_ALREADY_REVIEWED: {
		httpStatus: 409,
		message: "Esta solicitação já foi conferida",
	},
	INVALID_CREDENTIALS: {
		httpStatus: 401,
		/**
		 * Mensagem genérica de propósito: distinguir "e-mail não existe" de "senha
		 * errada" entrega um oráculo de enumeração de contas — quem ataca descobre
		 * quais e-mails estão cadastrados sem precisar de nenhuma senha.
		 */
		message: "E-mail ou senha inválidos",
	},
	INVALID_REFRESH_TOKEN: {
		httpStatus: 401,
		message: "Sessão inválida ou expirada. Faça login novamente",
	},
	USER_INACTIVE: {
		httpStatus: 403,
		message: "Usuário desativado",
	},
	DATABASE_UNAVAILABLE: {
		httpStatus: 503,
		message: "Banco de dados indisponível no momento",
	},
	INTERNAL_ERROR: {
		httpStatus: 500,
		message: "Erro interno no processamento da requisição",
	},
};
