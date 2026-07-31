/**
 * @module database/env
 *
 * Carregamento de `.env` para os scripts de linha de comando.
 *
 * Resolve os caminhos a partir do **diretório deste pacote**, não do `cwd`. A
 * diferença importa: `pnpm --filter @saude-bliss/database db:migrate` executa com
 * `cwd` em `packages/database`, onde não existe `.env` — e o script falhava com
 * "nenhuma origem de credencial configurada" numa máquina limpa, embora
 * funcionasse quando alguém já tinha exportado `DATABASE_URL`.
 *
 * Só vale para migrations, seed e Drizzle Kit. Em Lambda não há `.env`: a
 * credencial vem do Secrets Manager.
 */

import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Raiz do monorepo, a partir da localização deste arquivo. */
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/**
 * Ordem de precedência.
 *
 * O `dotenv` não sobrescreve variável já definida, então o primeiro que declarar
 * um valor vence — e uma variável exportada no shell vence todos, que é o
 * comportamento esperado para sobrescrever pontualmente.
 */
const CANDIDATOS = [
	join(REPO_ROOT, ".env.local"),
	join(REPO_ROOT, ".env"),
	join(REPO_ROOT, "apps", "api", ".env.local"),
	join(REPO_ROOT, "apps", "api", ".env"),
];

/** Compõe a URL a partir das variáveis do compose, quando não houver explícita. */
function composeFromPostgresVars(): string | undefined {
	const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT } = process.env;
	if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return undefined;

	const host = process.env.POSTGRES_HOST ?? "localhost";
	const port = POSTGRES_PORT ?? "5433";
	return `postgresql://${POSTGRES_USER}:${encodeURIComponent(POSTGRES_PASSWORD)}@${host}:${port}/${POSTGRES_DB}`;
}

/**
 * Carrega o ambiente e garante uma `DATABASE_URL`.
 *
 * O fallback a partir de `POSTGRES_*` existe porque o `.env` da raiz declara as
 * credenciais do compose: exigir que o mesmo dado fosse repetido como URL seria
 * duas fontes de verdade para a mesma coisa, prontas para divergir.
 */
export function loadDatabaseEnv(): string {
	for (const path of CANDIDATOS) {
		if (existsSync(path)) config({ path });
	}

	const url = process.env.DATABASE_URL ?? composeFromPostgresVars();
	if (!url) {
		throw new Error(
			"Não foi possível resolver DATABASE_URL. Defina-a no .env da raiz, " +
				"ou declare POSTGRES_USER, POSTGRES_PASSWORD e POSTGRES_DB."
		);
	}

	process.env.DATABASE_URL = url;
	return url;
}
