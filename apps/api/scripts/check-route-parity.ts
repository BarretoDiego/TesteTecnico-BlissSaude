/**
 * Verifica a paridade das rotas entre o router, o Terraform e o `serverless.yml`.
 *
 * ## Por que existe
 *
 * Cada rota é declarada em três lugares: no router do Fastify, no mapa `routes`
 * do módulo Terraform do serviço, e — só o prefixo — no `serverless.yml`. A
 * duplicação é real e assumida: o API Gateway precisa de um recurso por caminho
 * para autorizar **por método** e para rejeitar caminho inexistente sem gastar
 * invocação de Lambda; o Fastify precisa das rotas para despachar.
 *
 * Reconhecer uma duplicação e cercá-la com uma verificação automatizada lê muito
 * melhor do que fingir que ela não existe. O modo de falha que isto previne: alguém acrescenta uma rota no router, os
 * testes passam (usam o app diretamente) e só o deploy revela que o API Gateway
 * devolve 403 para ela, porque o recurso não existe.
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
const TERRAFORM_SERVICES_DIR = join(__dirname, "..", "..", "..", "infra", "terraform", "modules", "services");

/** Serviços verificados. Um serviço novo entra aqui. */
const SERVICES = ["bliss-requests", "bliss-reviews"] as const;

/** `/:id` (Fastify) e `/{id}` (API Gateway) descrevem o mesmo parâmetro. */
function toApiGatewayPath(path: string): string {
	return path.replace(/:(\w+)/g, "{$1}");
}

interface Divergence {
	service: string;
	message: string;
}

/**
 * Rotas declaradas no mapa `routes` do módulo Terraform do serviço.
 *
 * Lê o HCL como texto em vez de invocar o Terraform: o verificador roda no CI
 * sem credencial nem `terraform init`, e a declaração é estática.
 */
function readTerraformRoutes(service: string): Set<string> {
	const raw = readFileSync(join(TERRAFORM_SERVICES_DIR, service, "main.tf"), "utf8");

	const block = raw.match(/routes\s*=\s*\{([\s\S]*?)\n\s*\}/);
	if (!block?.[1]) return new Set();

	const routes = new Set<string>();
	for (const line of block[1].split("\n")) {
		const match = line.match(/^\s*"([A-Z]+)\s+(\S+)"\s*=/);
		if (match?.[1] && match[2]) routes.add(`${match[1]} ${match[2]}`);
	}
	return routes;
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

			// `/requests` e qualquer subcaminho descrevem o mesmo prefixo.
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

		// --- rota a rota: router vs Terraform ---------------------------------
		// O `/health` vem da plataforma (`createApp` o registra), então não está no
		// `ROUTES` do router; é comparado à parte.
		const fromRouter = new Set(ROUTES.map((route) => `${route.method} ${toApiGatewayPath(route.path)}`));
		fromRouter.add("GET /health");

		const fromTerraform = readTerraformRoutes(service);

		for (const route of fromRouter) {
			if (!fromTerraform.has(route)) {
				divergences.push({ service, message: `rota "${route}" existe no router mas não no Terraform` });
			}
		}
		for (const route of fromTerraform) {
			if (!fromRouter.has(route)) {
				divergences.push({ service, message: `rota "${route}" existe no Terraform mas não no router` });
			}
		}

		console.log(`✓ ${service}: ${ROUTE_PREFIX} (${fromRouter.size} rotas)`);
		for (const route of [...fromRouter].sort()) {
			console.log(`    ${route}`);
		}
	}

	if (divergences.length > 0) {
		console.error("\n✗ divergências encontradas:\n");
		for (const divergence of divergences) {
			console.error(`  ${divergence.service}: ${divergence.message}`);
		}
		process.exit(1);
	}

	console.log("\n✓ rotas em paridade entre o router, o Terraform e o serverless.yml");
}

main().catch((error) => {
	console.error("falha ao verificar paridade de rotas:", error);
	process.exit(1);
});
