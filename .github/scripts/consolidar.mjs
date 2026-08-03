/**
 * @module ci/consolidar
 *
 * Junta os fragmentos dos jobs em um documento só.
 *
 * O GitHub mostra o resumo de cada job separado, e cada job só conhece a si
 * mesmo. Quem lê o pipeline quer o contrário: uma tabela com a situação de
 * tudo, e o detalhe logo abaixo, na mesma tela. É isso que este script monta —
 * o resumo do job de consolidação, o comentário do PR e o artefato baixável
 * saem todos daqui.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argumentos, celula, saidaDoPasso, SITUACOES, tabela } from "./lib/relatorio.mjs";

const args = argumentos();
const dir = args.dir ?? join(process.env.GITHUB_WORKSPACE ?? process.cwd(), "relatorio");

/** Todos os `.md` do diretório, em profundidade — o download de artefatos aninha. */
function arquivosMarkdown(caminho) {
	let encontrados = [];
	for (const entrada of readdirSync(caminho, { withFileTypes: true })) {
		const completo = join(caminho, entrada.name);
		if (entrada.isDirectory()) encontrados = encontrados.concat(arquivosMarkdown(completo));
		else if (entrada.name.endsWith(".md")) encontrados.push(completo);
	}
	return encontrados;
}

const CABECALHO = /^<!-- bliss:etapa (.*) -->/;

const etapas = arquivosMarkdown(dir)
	.map((arquivo) => {
		const conteudo = readFileSync(arquivo, "utf8");
		const encontrado = conteudo.split("\n")[0]?.match(CABECALHO);
		if (!encontrado) return undefined;
		try {
			return { meta: JSON.parse(encontrado[1]), corpo: conteudo.split("\n").slice(1).join("\n").trim() };
		} catch {
			return undefined;
		}
	})
	.filter(Boolean)
	// Ordem declarada, e desempate por id: dois jobs de matriz que terminam em
	// ordem aleatória precisam aparecer sempre na mesma sequência, senão o
	// diff entre duas execuções é ilegível.
	.sort((a, b) => a.meta.ordem - b.meta.ordem || a.meta.id.localeCompare(b.meta.id));

const pior = etapas.reduce((acumulado, etapa) => {
	const peso = SITUACOES[etapa.meta.situacao]?.peso ?? 0;
	return peso > acumulado ? peso : acumulado;
}, 0);
const situacaoGeral = pior === 2 ? "falha" : pior === 1 ? "alerta" : "ok";

const contagem = etapas.reduce((acumulado, etapa) => {
	acumulado[etapa.meta.situacao] = (acumulado[etapa.meta.situacao] ?? 0) + 1;
	return acumulado;
}, {});

// --- contexto ----------------------------------------------------------------
const servidor = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repositorio = process.env.GITHUB_REPOSITORY ?? "";
const execucao = process.env.GITHUB_RUN_ID
	? `[#${process.env.GITHUB_RUN_NUMBER}](${servidor}/${repositorio}/actions/runs/${process.env.GITHUB_RUN_ID})`
	: "—";
const commit = process.env.GITHUB_SHA ?? "";
const commitCurto = commit.slice(0, 7) || "—";

const contexto = tabela(
	["Contexto", "Valor"],
	[
		["Execução", execucao],
		["Commit", commit ? `[\`${commitCurto}\`](${servidor}/${repositorio}/commit/${commit})` : "—"],
		["Referência", `\`${celula(process.env.GITHUB_REF_NAME ?? "—")}\``],
		["Evento", `\`${celula(process.env.GITHUB_EVENT_NAME ?? "—")}\``],
		["Disparado por", `@${celula(process.env.GITHUB_ACTOR ?? "—")}`],
		["Concluído em", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"],
	]
);

const ICONE_GERAL = { ok: "✅", alerta: "⚠️", falha: "❌" }[situacaoGeral];
const FRASE_GERAL = {
	ok: "Todas as etapas passaram.",
	alerta: "Passou, com pontos de atenção — veja as linhas marcadas com ⚠️.",
	falha: "**O pipeline falhou.** As etapas em ❌ têm o detalhe da causa abaixo.",
}[situacaoGeral];

const documento = [
	// O marcador é como a execução seguinte encontra o comentário deste
	// relatório no pull request para editá-lo em vez de criar outro.
	...(args.marcador ? [`<!-- ${args.marcador} -->`] : []),
	`# ${ICONE_GERAL} ${args.titulo ?? "Relatório do pipeline"}`,
	"",
	FRASE_GERAL,
	"",
	contexto,
	"",
	"## Situação por etapa",
	"",
	tabela(
		["Etapa", "Situação", "Resumo"],
		etapas.map((etapa) => [
			celula(etapa.meta.titulo),
			`${SITUACOES[etapa.meta.situacao]?.icone ?? "•"} ${SITUACOES[etapa.meta.situacao]?.rotulo ?? etapa.meta.situacao}`,
			celula(etapa.meta.resumo),
		])
	),
	"",
	"## Detalhe",
	"",
	etapas.map((etapa) => etapa.corpo).join("\n\n---\n\n"),
	"",
].join("\n");

// --- destinos ----------------------------------------------------------------
if (args.saida) {
	mkdirSync(dirname(args.saida), { recursive: true });
	writeFileSync(args.saida, documento, "utf8");
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${documento}\n`, "utf8");

saidaDoPasso("situacao", situacaoGeral);
saidaDoPasso("etapas", String(etapas.length));
saidaDoPasso("falhas", String(contagem.falha ?? 0));

process.stdout.write(`${etapas.length} etapas consolidadas · situação ${situacaoGeral}\n`);

// O código de saída é opcional de propósito: quem decide se o pipeline falha é
// o job de cada etapa, não o relatório. Ligar `--falhar` serve para os casos em
// que este job é o único obrigatório na proteção de branch.
if (args.falhar === "true" && situacaoGeral === "falha") process.exit(1);
