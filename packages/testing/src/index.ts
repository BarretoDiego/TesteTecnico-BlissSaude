/**
 * @module testing
 *
 * Utilitários de teste compartilhados.
 *
 * Vivem fora dos microserviços porque as factories descrevem o **contrato** —
 * mudam quando o schema muda, não quando um domínio muda. Duplicá-las por
 * serviço garantiria que uma delas ficasse desatualizada silenciosamente.
 */

export * from "./factories";
export * from "./fastifyMocks";
