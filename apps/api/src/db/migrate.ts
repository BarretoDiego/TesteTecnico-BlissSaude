/**
 * @module api/db/migrate
 *
 * Aplica as migrations pendentes.
 *
 * Roda a partir do host, nunca de dentro da Lambda. Migration em cold start é um
 * antipadrão conhecido: invocações concorrentes disparariam migrations
 * simultâneas e o tempo de execução entraria na latência da primeira requisição.
 */

import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

import { closeDb, getDb } from "@/db/client";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "node:path";

async function main(): Promise<void> {
	console.log("aplicando migrations...");
	const db = await getDb();
	await migrate(db, { migrationsFolder: join(__dirname, "migrations") });
	console.log("migrations aplicadas");
	await closeDb();
}

main().catch(async (error) => {
	console.error("falha ao aplicar migrations:", error);
	await closeDb();
	process.exit(1);
});
