/**
 * Verifica a paridade entre as rotas do código e as declaradas no `serverless.yml`.
 *
 * ## Por que existe
 *
 * O prefixo de domínio aparece em dois lugares: no `ROUTE_PREFIX` do router e no
 * `path` dos eventos HTTP do `serverless.yml`. Essa duplicação é real e assumida
 * — o Serverless precisa saber o caminho para emular o API Gateway, e o Fastify
 * precisa saber para montar as rotas.
 *
 * Reconhecer uma duplicação e cercá-la com uma verificação automatizada lê muito
 * melhor do que fingir que ela não existe. O modo de falha que isto previne:
 * alguém renomeia o prefixo no código, os testes passam (usam o app diretamente),
 * e só o deploy revela que o API Gateway continua encaminhando o caminho antigo.
 *
 * Roda no CI (`pnpm check:routes`) e sai com código 1 na divergência.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

interface ServerlessConfig {
	service?: string;
	functions?: Record<string, { events?: Array<{ http?: { path?: string } }> }>;
}

const FUNCTIONS_DIR = join(__dirname, "..", "functions");

/** Serviços verificados. Um serviço novo entra aqui. */
const SERVICES = ["bliss-requests", "bliss-reviews"] as const;

interface Divergence {
	service: string;
	message: string;
}

/** Caminhos declarados no `serverless.yml`, normalizados para o prefixo raiz. */
function readServerlessPrefixes(service: string): Set<string> {
	const raw = readFileSync(join(FUNCTIONS_DIR, service, "serverless.yml"), "utf8");
	const config = parse(raw) as ServerlessConfig;

	const prefixes = new Set<string>();
	for (const fn of Object.values(config.functions ?? {})) {
		for (const event of fn.events ?? []) {
			const path = event.http?.path;
			if (!path) continue;

			// `/requests` e `/requests/{proxy+}` descrevem o mesmo prefixo.
			const normalized = `/${path.replace(/^\//, "").split("/")[0]}`;
			prefixes.add(normalized);
		}
	}
	return prefixes;
}

async function main(): Promise<void> {
	const divergences: Divergence[] = [];

	for (const service of SERVICES) {
		const { ROUTE_PREFIX, ROUTES } = (await import(join(FUNCTIONS_DIR, service, "src", "router", "index.ts"))) as {
			ROUTE_PREFIX: string;
			ROUTES: ReadonlyArray<{ method: string; path: string }>;
		};

		const declared = readServerlessPrefixes(service);

		if (declared.size === 0) {
			divergences.push({ service, message: "serverless.yml não declara nenhum evento http" });
			continue;
		}

		if (declared.size > 1) {
			divergences.push({
				service,
				message: `serverless.yml declara mais de um prefixo (${[...declared].join(", ")}); um serviço deve ter um só`,
			});
			continue;
		}

		const [serverlessPrefix] = [...declared];
		if (serverlessPrefix !== ROUTE_PREFIX) {
			divergences.push({
				service,
				message: `prefixo divergente — router: "${ROUTE_PREFIX}", serverless.yml: "${serverlessPrefix}"`,
			});
		}

		// Rota greedy ausente significa que só a raiz seria encaminhada, e
		// `/requests/{id}` cairia em 404 no API Gateway antes de chegar à Lambda.
		const raw = readFileSync(join(FUNCTIONS_DIR, service, "serverless.yml"), "utf8");
		if (!raw.includes("{proxy+}")) {
			divergences.push({ service, message: "serverless.yml não declara a rota greedy `{proxy+}`" });
		}

		console.log(`✓ ${service}: ${ROUTE_PREFIX} (${ROUTES.length} rotas)`);
	}

	if (divergences.length > 0) {
		console.error("\n✗ divergências encontradas:\n");
		for (const divergence of divergences) {
			console.error(`  ${divergence.service}: ${divergence.message}`);
		}
		process.exit(1);
	}

	console.log("\n✓ rotas em paridade entre o código e o serverless.yml");
}

main().catch((error) => {
	console.error("falha ao verificar paridade de rotas:", error);
	process.exit(1);
});
