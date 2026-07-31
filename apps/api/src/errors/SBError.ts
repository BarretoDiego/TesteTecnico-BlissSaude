/**
 * @module api/errors/SBError
 *
 * Erro de domínio da aplicação.
 *
 * Equivale ao `AOError` / `BVError` dos projetos da casa. Código de domínio
 * nunca lança `Error` cru: sem código, o handler não sabe distinguir uma regra
 * de negócio violada (que é 4xx e esperada) de um defeito (que é 5xx e precisa
 * alarmar).
 */

import type { ErrorCode } from "@saude-bliss/contracts";
import { ERROR_CATALOG } from "./catalog";

export interface SBErrorOptions {
	/** Sobrescreve a mensagem do catálogo quando o contexto pede algo específico. */
	message?: string;
	/** Contexto estruturado devolvido no envelope. Nunca inclua dado sensível. */
	details?: unknown;
	/** Erro original, preservado para o log — não vai para a resposta. */
	cause?: unknown;
}

export class SBError extends Error {
	readonly code: ErrorCode;
	readonly httpStatus: number;
	readonly details?: unknown;
	override readonly cause?: unknown;

	private constructor(code: ErrorCode, httpStatus: number, message: string, options?: SBErrorOptions) {
		super(message);
		this.name = "SBError";
		this.code = code;
		this.httpStatus = httpStatus;
		this.details = options?.details;
		this.cause = options?.cause;
		Error.captureStackTrace?.(this, SBError);
	}

	/**
	 * Único construtor público. Força a passagem por um código do catálogo, o que
	 * torna impossível inventar um status HTTP no meio do domínio.
	 */
	static from(code: ErrorCode, options?: SBErrorOptions): SBError {
		const definition = ERROR_CATALOG[code];
		return new SBError(code, definition.httpStatus, options?.message ?? definition.message, options);
	}

	static isSBError(error: unknown): error is SBError {
		return error instanceof SBError;
	}

	/** Forma segura para a resposta — `cause` e `stack` ficam de fora. */
	toDetail(): { code: ErrorCode; message: string; details?: unknown } {
		return {
			code: this.code,
			message: this.message,
			...(this.details !== undefined ? { details: this.details } : {}),
		};
	}
}
