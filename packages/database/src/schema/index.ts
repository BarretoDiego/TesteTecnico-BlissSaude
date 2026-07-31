/**
 * @module api/db/schema
 *
 * Barrel do schema. O `drizzle-kit` e o client consomem daqui, então uma tabela
 * nova só precisa ser reexportada neste arquivo para entrar nas migrations.
 */

export * from "./enums.schema";
export * from "./requests.schema";
