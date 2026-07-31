/**
 * @module api/errors/DefaultErroHandler
 *
 * Normalização de erros para o envelope de resposta.
 *
 * O nome mantém a grafia usada nos projetos da casa (`DefaultErroHandler`) de
 * propósito: quem vem do Eyecare encontra o mesmo símbolo. Renomear aqui só
 * criaria um dialeto novo.
 *
 * A **ordem de classificação importa**: o caso mais específico vem primeiro, e o
 * `catch-all` nunca vaza detalhe interno para o cliente.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { logger } from "../utils/BlissLogger";
import { blissFail } from "../utils/responseEnvelope";
import { BlissError } from "./BlissError";
import { ERROR_CATALOG } from "./catalog";

/**
 * Erro de validação do próprio Fastify.
 *
 * O Fastify valida `body`, `params` e `querystring` contra o JSON Schema da rota
 * no estágio `preValidation` — **antes** dos middlewares registrados como
 * `preHandler`. O erro dele não é um `ZodError` nem um `BlissError`, então sem
 * este reconhecimento caía no catch-all e virava **500**: qualquer rota com
 * schema declarado devolvia erro de servidor para entrada inválida do cliente.
 */
interface FastifyValidationError {
	validation: Array<{ instancePath?: string; params?: Record<string, unknown>; message?: string }>;
	validationContext?: string;
}

function isFastifyValidationError(error: unknown): error is FastifyValidationError {
	return typeof error === "object" && error !== null && Array.isArray((error as FastifyValidationError).validation);
}

/** Traduz os problemas do Ajv para o mesmo formato dos problemas do Zod. */
function formatFastifyIssues(error: FastifyValidationError): Array<{ field: string; message: string }> {
	return error.validation.map((issue) => {
		// `instancePath` vem como "/status"; o contexto diz de onde — body, params,
		// querystring. Compor os dois dá "querystring.status", que é acionável.
		const path = (issue.instancePath ?? "").replace(/^\//, "").replace(/\//g, ".");
		const context = error.validationContext ?? "";
		const field = [context, path].filter(Boolean).join(".") || "(raiz)";
		return { field, message: issue.message ?? "valor inválido" };
	});
}

/** Achata o `ZodError` em algo consumível por um formulário no front. */
function formatZodIssues(error: ZodError): Array<{ field: string; message: string }> {
	return error.issues.map((issue) => ({
		field: issue.path.join(".") || "(raiz)",
		message: issue.message,
	}));
}

/**
 * Códigos do Postgres que indicam indisponibilidade, não erro de aplicação.
 * Viram 503 (retentável) em vez de 500 (defeito), o que muda como o cliente e
 * o alarme reagem.
 */
const PG_UNAVAILABLE_CODES = new Set(["08000", "08003", "08006", "08001", "08004", "57P01", "57P02", "57P03", "53300"]);

function isDatabaseUnavailable(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && PG_UNAVAILABLE_CODES.has(code);
}

export interface ErrorHandlerContext {
	module?: string;
	action?: string;
}

/**
 * Converte qualquer erro em uma resposta com envelope.
 *
 * Sempre retorna a `FastifyReply` — os controllers fazem `return DefaultErroHandler(...)`,
 * o que impede o fluxo de continuar depois de responder.
 */
export function DefaultErroHandler(
	error: unknown,
	res: FastifyReply,
	req: FastifyRequest,
	context: ErrorHandlerContext = {}
): FastifyReply {
	const module = context.module ?? "DefaultErroHandler";
	const action = context.action ?? "handle";

	// 1. Erro de validação — o mais comum, e o único que devolve o detalhe do campo.
	if (error instanceof ZodError) {
		const definition = ERROR_CATALOG.VALIDATION_ERROR;
		logger.log("warn", module, action, "payload inválido", { issues: formatZodIssues(error) });
		return blissFail(res, req, definition.httpStatus, {
			code: "VALIDATION_ERROR",
			message: definition.message,
			details: formatZodIssues(error),
		});
	}

	// 2. Validação do Fastify (Ajv), que acontece antes dos middlewares.
	if (isFastifyValidationError(error)) {
		const definition = ERROR_CATALOG.VALIDATION_ERROR;
		logger.log("warn", module, action, "payload rejeitado pelo schema da rota", {
			issues: formatFastifyIssues(error),
		});
		return blissFail(res, req, definition.httpStatus, {
			code: "VALIDATION_ERROR",
			message: definition.message,
			details: formatFastifyIssues(error),
		});
	}

	// 3. Erro de domínio — status e mensagem já vieram do catálogo.
	if (BlissError.isBlissError(error)) {
		// 4xx é regra de negócio, não defeito: `warn` para não sujar o alarme de erro.
		const level = error.httpStatus >= 500 ? "error" : "warn";
		logger.log(level, module, action, error.message, { code: error.code, details: error.details, cause: error.cause });
		return blissFail(res, req, error.httpStatus, error.toDetail());
	}

	// 4. Banco fora do ar — retentável, não é defeito da aplicação.
	if (isDatabaseUnavailable(error)) {
		const definition = ERROR_CATALOG.DATABASE_UNAVAILABLE;
		logger.log("error", module, action, "banco de dados indisponível", { error });
		return blissFail(res, req, definition.httpStatus, {
			code: "DATABASE_UNAVAILABLE",
			message: definition.message,
		});
	}

	// 5. Desconhecido. Loga tudo, devolve o mínimo — stack trace em resposta de
	//    erro é vazamento de informação, e o `requestId` já liga a resposta ao log.
	const definition = ERROR_CATALOG.INTERNAL_ERROR;
	logger.log("error", module, action, "erro não tratado", { error });
	return blissFail(res, req, definition.httpStatus, {
		code: "INTERNAL_ERROR",
		message: definition.message,
	});
}
