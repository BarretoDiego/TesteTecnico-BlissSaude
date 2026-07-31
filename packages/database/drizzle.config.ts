/**
 * @module api/drizzle.config
 *
 * Configuração do drizzle-kit (geração de migrations e Studio).
 *
 * Usado apenas em tempo de desenvolvimento — a Lambda nunca carrega este arquivo.
 * Por isso lê `DATABASE_URL` direto do `.env`, sem passar pelo Secrets Manager.
 */

import { defineConfig } from "drizzle-kit";
import { loadDatabaseEnv } from "./src/env";

// Resolve o `.env` a partir da raiz do monorepo, não do `cwd` — ver src/env.ts.
const databaseUrl = loadDatabaseEnv();

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/index.ts",
	out: "./src/migrations",
	dbCredentials: {
		url: databaseUrl,
	},
	verbose: true,
	strict: true,
});
