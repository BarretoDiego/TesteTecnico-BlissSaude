/**
 * @module contracts
 *
 * Ponto de entrada do pacote compartilhado. Exposto como `main: ./src/index.ts`
 * (sem etapa de build): o esbuild da API o embute no bundle e o Next o transpila
 * via `transpilePackages`. Sem `dist/`, sem a classe inteira de bugs de artefato
 * desatualizado.
 */

export * from "./auth.schema";
export * from "./enums";
export * from "./envelope";
export * from "./request.schema";
