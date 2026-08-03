/**
 * @module api/errors/BlissError
 *
 * Erro de domínio da aplicação.
 *
 * Código de domínio
 * nunca lança `Error` cru: sem código, o handler não sabe distinguir uma regra
 * de negócio violada (que é 4xx e esperada) de um defeito (que é 5xx e precisa
 * alarmar).
 */

import type { ErrorCode } from "@saude-bliss/contracts";
import { ERROR_CATALOG } from "./catalog";

export interface BlissErrorOptions {
	/** Sobrescreve a mensagem do catálogo quando o contexto pede algo específico. */
	message?: string;
	/** Contexto estruturado devolvido no envelope. Nunca inclua dado sensível. */
	details?: unknown;
	/** Erro original, preservado para o log — não vai para a resposta. */
	cause?: unknown;
}

export class BlissError extends Error {
	readonly code: ErrorCode;
	readonly httpStatus: number;
	readonly details?: unknown;
	override readonly cause?: unknown;

	private constructor(code: ErrorCode, httpStatus: number, message: string, options?: BlissErrorOptions) {
		super(message);
		this.name = "BlissError";
		this.code = code;
		this.httpStatus = httpStatus;
		this.details = options?.details;
		this.cause = options?.cause;
		Error.captureStackTrace?.(this, BlissError);
	}

	/**
	 * Único construtor público. Força a passagem por um código do catálogo, o que
	 * torna impossível inventar um status HTTP no meio do domínio.
	 */
	static from(code: ErrorCode, options?: BlissErrorOptions): BlissError {
		const definition = ERROR_CATALOG[code];
		return new BlissError(code, definition.httpStatus, options?.message ?? definition.message, options);
	}

	static isBlissError(error: unknown): error is BlissError {
		return error instanceof BlissError;
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
