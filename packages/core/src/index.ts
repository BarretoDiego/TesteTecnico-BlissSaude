/**
 * @module core
 *
 * Runtime compartilhado pelos microserviços.
 *
 * Exposto como `main: ./src/index.ts` (sem etapa de build): o esbuild de cada
 * serviço o embute no bundle e o Jest o resolve por `moduleNameMapper`. Sem
 * `dist/`, sem a classe inteira de bugs de artefato desatualizado.
 *
 * Regra de fronteira: o que está aqui não pode conhecer nenhum domínio. Se um
 * símbolo precisa saber o que é uma "solicitação", ele pertence ao microserviço,
 * não a este pacote.
 */

// Aplicação
export { createApp, type CreateAppOptions } from "./app/createApp";
export { HealthDataSchema, HealthResponseSchema, registerHealthRoute, type HealthProbe } from "./app/healthRoute";
export { createLambdaHandler } from "./app/lambda";
export { runLocal, type RunLocalOptions } from "./app/runLocal";
export { setupSwagger } from "./app/swagger";

// Classes base
export { BaseController } from "./common/BaseController";
export { BaseRepository } from "./common/BaseRepository";
export { BaseService } from "./common/BaseService";
export { WithLogging } from "./common/WithLogging";

// Configuração
export { EnvService, type AppEnv } from "./config/EnvService";
export { SecretsService } from "./config/SecretsService";

// Erros
export { BlissError, type BlissErrorOptions } from "./errors/BlissError";
export { ERROR_CATALOG, type ErrorDefinition } from "./errors/catalog";
export { DefaultErroHandler, type ErrorHandlerContext } from "./errors/DefaultErroHandler";

// Utilitários
export { BlissLogger, logger, type LogLevel, type LogParams } from "./utils/BlissLogger";
export { toJsonSchema, type JsonSchema } from "./utils/jsonSchema";
export {
	enterRequestContext,
	getElapsedMs,
	getRequestContext,
	getRequestId,
	runWithRequestContext,
	type RequestContext,
} from "./utils/requestContext";
export { blissFail, blissSuccess, buildErrorResponseSchema, resolveRequestId } from "./utils/responseEnvelope";
