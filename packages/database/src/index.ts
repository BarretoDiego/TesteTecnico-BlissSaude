/**
 * @module database
 *
 * Schema e conexão compartilhados.
 *
 * Todos os microserviços leem e escrevem no mesmo RDS, então o schema precisa ser
 * único — duas definições da tabela `requests` divergiriam na primeira migration.
 * O que **não** fica aqui são as queries: cada serviço tem seu próprio
 * `*DatabaseService` com apenas as operações do seu domínio, o que mantém a
 * fronteira de responsabilidade visível mesmo com o banco sendo compartilhado.
 */

export { closeDb, getDb, schema, type Database } from "./client";
export * from "./mappers";
export * from "./schema";
