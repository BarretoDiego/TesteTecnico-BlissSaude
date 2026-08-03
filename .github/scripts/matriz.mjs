/**
 * @module ci/matriz
 *
 * Descobre o que existe para verificar e emite as matrizes do pipeline.
 *
 * As matrizes são derivadas do disco, não escritas à mão: um microserviço novo
 * é um diretório novo em `apps/api/functions/` e entra no pipeline sozinho. A
 * lista fixa é a forma silenciosa de um serviço passar meses sem cobertura no
 * CI — ninguém percebe uma ausência.
 *
 * Emite também o **plano de execução**: a primeira coisa que aparece no
 * relatório, respondendo "o que este pipeline vai fazer" antes de qualquer
 * resultado.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argumentos, celula, publicar, saidaDoPasso, tabela } from "./lib/relatorio.mjs";

const args = argumentos();
const RAIZ = args.raiz ?? process.env.GITHUB_WORKSPACE ?? process.cwd();

const DIR_FUNCOES = join(RAIZ, "apps", "api", "functions");
const DIR_PACOTES = join(RAIZ, "packages");
const DIR_APPS = join(RAIZ, "apps");

/** Diretórios diretos de um caminho. Vazio quando o caminho não existe. */
function subdiretorios(caminho) {
	if (!existsSync(caminho)) return [];
	return readdirSync(caminho, { withFileTypes: true })
		.filter((entrada) => entrada.isDirectory())
		.map((entrada) => entrada.name)
		.sort();
}

function nomeDoPacote(caminho) {
	try {
		return JSON.parse(readFileSync(join(caminho, "package.json"), "utf8")).name;
	} catch {
		return undefined;
	}
}

/**
 * Pacotes com suíte de teste.
 *
 * O critério é a presença de `jest.config.js` — o mesmo arquivo que o Jest usa,
 * então não existe estado a sincronizar entre o pipeline e o pacote.
 */
function pacotesDeTeste() {
	const candidatos = [
		...subdiretorios(DIR_PACOTES).map((nome) => ({ nome, caminho: join("packages", nome) })),
		// `apps/*` cobre o backoffice; `apps/api` não tem suíte própria (as dela
		// vivem nos microserviços) e cai fora pelo critério do `jest.config.js`.
		...subdiretorios(DIR_APPS).map((nome) => ({ nome, caminho: join("apps", nome) })),
		...subdiretorios(DIR_FUNCOES).map((nome) => ({ nome, caminho: join("apps", "api", "functions", nome) })),
	];

	return candidatos
		.filter((pacote) => existsSync(join(RAIZ, pacote.caminho, "jest.config.js")))
		.map((pacote) => ({
			nome: pacote.nome,
			caminho: pacote.caminho,
			pacote: nomeDoPacote(join(RAIZ, pacote.caminho)) ?? pacote.nome,
			// A camada e2e exercita SQL real: sem Postgres no ar e sem migrations
			// aplicadas ela falha por tabela inexistente, e o erro não indica isso.
			banco: existsSync(join(RAIZ, pacote.caminho, "__tests__", "e2e")),
		}));
}

/** Microserviços empacotáveis — os que têm `build.js`. */
function servicos() {
	return subdiretorios(DIR_FUNCOES)
		.filter((nome) => existsSync(join(DIR_FUNCOES, nome, "build.js")))
		.map((nome) => ({ nome, caminho: join("apps", "api", "functions", nome) }));
}

const testes = pacotesDeTeste();
const empacotaveis = servicos();

saidaDoPasso("testes", JSON.stringify(testes));
saidaDoPasso("servicos", JSON.stringify(empacotaveis));
saidaDoPasso("quantidade-testes", String(testes.length));
saidaDoPasso("quantidade-servicos", String(empacotaveis.length));

const evento = process.env.GITHUB_EVENT_NAME ?? "local";
const referencia = process.env.GITHUB_REF_NAME ?? "—";
const commit = (process.env.GITHUB_SHA ?? "").slice(0, 7) || "—";

const corpo = [
	"Tudo abaixo roda **em paralelo**. As dependências entre jobs são só as reais:",
	"empacotar depende do plano (para saber quais serviços existem), e a consolidação",
	"depende de todos — porque relatório de pipeline incompleto é pior que nenhum.",
	"",
	`**Contexto** — evento \`${evento}\` · ref \`${referencia}\` · commit \`${commit}\``,
	"",
	"#### Suítes de teste",
	"",
	tabela(
		["Pacote", "Caminho", "Precisa de Postgres"],
		testes.map((t) => [celula(t.nome), `\`${celula(t.caminho)}\``, t.banco ? "sim (camada e2e)" : "não"])
	),
	"",
	"#### Microserviços empacotados",
	"",
	tabela(
		["Serviço", "Artefato"],
		empacotaveis.map((s) => [celula(s.nome), `\`${celula(s.caminho)}/dist/function.zip\``])
	),
].join("\n");

publicar({
	id: "plano",
	ordem: 0,
	titulo: "Plano de execução",
	situacao: "ok",
	resumo: `${testes.length} suítes · ${empacotaveis.length} microserviços · matrizes derivadas do disco.`,
	corpo,
});
