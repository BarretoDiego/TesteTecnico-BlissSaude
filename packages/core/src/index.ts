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
 * não a este pacote. E `core` não importa `database`: plataforma não depende de
 * persistência — um serviço sem banco não deve carregar o driver do Postgres.
 */

// Aplicação
export {
	allow,
	buildResourceArn,
	createAuthorizerHandler,
	deny,
	type AuthorizedPrincipal,
	type AuthorizerEvent,
	type PolicyDocument,
	type TokenVerifier,
} from "./app/authorizer";
export { createAggregatedApp, type CreateAggregatedAppOptions } from "./app/createAggregatedApp";
export { applyPlatform, createApp, type CreateAppOptions } from "./app/createApp";
export { defineService, serviceTag, type ServiceDefinition } from "./app/defineService";
export { HealthDataSchema, HealthResponseSchema, registerHealthRoute, type HealthProbe } from "./app/healthRoute";
export { createLambdaHandler } from "./app/lambda";
export { describeRoutes, type DomainRouter, type RouteDescriptor, type RouterOptions } from "./app/router";
export { runLocal, type RunLocalOptions } from "./app/runLocal";
export { setupSwagger } from "./app/swagger";

// Integrações AWS
export { buildAwsClientConfig, getAwsClient, resetAwsClients, type AwsClientConfig } from "./aws/AwsClientFactory";
export { CloudWatchService, cloudWatchService, type Metric } from "./aws/CloudWatchService";
export { EventBridgeService, eventBridgeService, type DomainEvent } from "./aws/EventBridgeService";
export { S3Service, s3Service, type UploadInput } from "./aws/S3Service";
export { SecretsManagerService, secretsManagerService } from "./aws/SecretsManagerService";
export { SqsService, sqsService, type ReceivedMessage, type SqsMessage } from "./aws/SqsService";

// Classes base
export { BaseController } from "./common/BaseController";
export { BaseRepository } from "./common/BaseRepository";
export { BaseService } from "./common/BaseService";
export { WithLogging } from "./common/WithLogging";

// Configuração
export { EnvService, envService, type AppEnv } from "./config/EnvService";
export { SecretsService, secretsService } from "./config/SecretsService";

// Segurança
export { PasswordService, passwordService } from "./security/PasswordService";
export { SigningKeyService, signingKeyService } from "./security/SigningKeyService";

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
