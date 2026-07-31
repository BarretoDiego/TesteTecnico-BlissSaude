/**
 * @module api/drizzle.config
 *
 * Configuração do drizzle-kit (geração de migrations e Studio).
 *
 * Usado apenas em tempo de desenvolvimento — a Lambda nunca carrega este arquivo.
 * Por isso lê `DATABASE_URL` direto do `.env`, sem passar pelo Secrets Manager.
 */

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"] });

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/db/schema/index.ts",
	out: "./src/db/migrations",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgresql://saudebliss:saudebliss@localhost:5433/saudebliss",
	},
	verbose: true,
	strict: true,
});
