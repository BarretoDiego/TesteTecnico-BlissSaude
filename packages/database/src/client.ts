/**
 * @module api/db/client
 *
 * Conexão com o Postgres.
 *
 * ## Pool em Lambda
 *
 * O ponto crítico: cada container quente mantém o próprio pool. Com `max: 10` e
 * 50 containers concorrentes seriam 500 conexões contra uma `db.t4g.micro`, que
 * aguenta ~87 — o banco recusa e a API cai inteira, não só o excedente.
 *
 * Por isso `max: 1` e um teto duro de concorrência reservada na Lambda
 * (`reserved_concurrency` no Terraform). A aritmética que precisa ser respeitada:
 *
 *     max_connections >= reserved_concurrency * pool_max + folga_operacional
 *
 * Em produção de verdade a resposta é RDS Proxy, que multiplexa conexões e
 * remove o acoplamento entre concorrência de Lambda e limite do banco. Não foi
 * adotado no ambiente local porque o suporte do LocalStack é parcial. Ver
 * docs/adr/0004-rds-e-pool-de-conexoes.md.
 */

import { logger, secretsService } from "@saude-bliss/core";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

/**
 * Escopo de módulo, não escopo de requisição: é isso que permite ao socket TCP
 * sobreviver entre invocações no mesmo container. Combinado com
 * `callbackWaitsForEmptyEventLoop: false`, elimina o handshake do Postgres
 * (~30ms) de toda requisição que não for cold start.
 */
let pool: Pool | undefined;
let database: Database | undefined;
let connecting: Promise<Database> | undefined;

async function createDatabase(): Promise<Database> {
	const connectionString = await secretsService.getDatabaseUrl();

	pool = new Pool({
		connectionString,
		// Ver a aritmética no topo do arquivo.
		max: Number(process.env.DB_POOL_MAX ?? 1),
		// Mantém o socket vivo entre invocações próximas sem segurá-lo para sempre.
		idleTimeoutMillis: 30_000,
		// Falha rápido: sem isso a Lambda fica pendurada até o timeout dela,
		// pagando duração cheia por uma conexão que nunca vai acontecer.
		connectionTimeoutMillis: 5_000,
		// O RDS exige TLS mas apresenta certificado de CA própria; o LocalStack e o
		// Postgres do compose não usam TLS.
		...(process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: false } } : {}),
	});

	// Erro em conexão ociosa do pool é assíncrono: sem este listener, o processo
	// morre com `unhandledError` quando o banco derruba a conexão.
	pool.on("error", (error) => {
		logger.log("error", "Database", "pool", "erro em conexão ociosa do pool", { error });
	});

	return drizzle(pool, { schema });
}

/**
 * Instância do Drizzle, criada sob demanda.
 *
 * A promessa em `connecting` é deduplicação: em cold start com invocações
 * concorrentes, sem ela dois pools seriam criados e um vazaria.
 */
export async function getDb(): Promise<Database> {
	if (database) return database;
	if (!connecting) {
		connecting = createDatabase().then((db) => {
			database = db;
			return db;
		});
	}
	return connecting;
}

/**
 * Fecha o pool.
 *
 * **Nunca chamar por requisição** — anularia todo o benefício do pool em escopo
 * de módulo. Existe para o teardown dos testes e para scripts que precisam
 * terminar o processo.
 */
export async function closeDb(): Promise<void> {
	await pool?.end();
	pool = undefined;
	database = undefined;
	connecting = undefined;
}

export { schema };
