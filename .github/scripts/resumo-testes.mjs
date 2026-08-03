/**
 * @module ci/resumo-testes
 *
 * Relatório de uma suíte: quantos testes, por camada, com que cobertura e a
 * que distância das metas do próprio pacote.
 *
 * As metas não são digitadas aqui — vêm do `coverageThreshold` do
 * `jest.config.js` do pacote, que é o mesmo número que faz o Jest falhar. Um
 * limite repetido no pipeline diverge do limite real na primeira vez que
 * alguém ajusta um dos dois, e o relatório passa a mentir.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { argumentos, barra, celula, duracao, publicar, recolhido, recuar, tabela } from "./lib/relatorio.mjs";

const args = argumentos();
const RAIZ = process.env.GITHUB_WORKSPACE ?? process.cwd();
const dir = isAbsolute(args.dir ?? "") ? args.dir : join(RAIZ, args.dir ?? ".");
const nome = args.pacote ?? relative(RAIZ, dir);

function lerJson(caminho) {
	if (!existsSync(caminho)) return undefined;
	try {
		return JSON.parse(readFileSync(caminho, "utf8"));
	} catch {
		return undefined;
	}
}

const resultados = lerJson(join(dir, args.resultados ?? "jest-resultados.json"));
const cobertura = lerJson(join(dir, "coverage", "coverage-summary.json"));

/** Metas do pacote, lidas da configuração real do Jest. */
function metas() {
	try {
		const require = createRequire(import.meta.url);
		const config = require(join(dir, "jest.config.js"));
		return config.coverageThreshold ?? {};
	} catch {
		return {};
	}
}

/**
 * Camada de um arquivo de teste.
 *
 * O caminho já carrega a informação (`__tests__/unit/...`), então não é preciso
 * o Jest devolver o `displayName` do project — que ele nem sempre devolve.
 *
 * Pacote sem subdiretório (`__tests__/x.test.ts`) tem uma camada só, e ela é
 * unitária por construção: são os pacotes compartilhados, que não tocam I/O.
 */
function camadaDe(arquivo) {
	const partes = arquivo.split(`__tests__${sep}`)[1]?.split(sep) ?? [];
	const primeira = partes[0];
	if (!primeira) return "outros";
	return primeira.includes(".") ? "unit" : primeira;
}

// --- contagens ---------------------------------------------------------------
const total = resultados?.numTotalTests ?? 0;
const passaram = resultados?.numPassedTests ?? 0;
const falharam = resultados?.numFailedTests ?? 0;
const pendentes = (resultados?.numPendingTests ?? 0) + (resultados?.numTodoTests ?? 0);
const suites = resultados?.numTotalTestSuites ?? 0;

const fim = Math.max(0, ...(resultados?.testResults ?? []).map((s) => s.endTime ?? 0));
const ms = resultados?.startTime && fim ? fim - resultados.startTime : Number(args["duracao-ms"] ?? NaN);

// --- por camada --------------------------------------------------------------
const porCamada = new Map();
for (const suite of resultados?.testResults ?? []) {
	const camada = camadaDe(suite.name ?? "");
	const atual = porCamada.get(camada) ?? { suites: 0, testes: 0, falhas: 0, ms: 0 };
	atual.suites += 1;
	atual.testes += suite.assertionResults?.length ?? 0;
	atual.falhas += (suite.assertionResults ?? []).filter((t) => t.status === "failed").length;
	atual.ms += (suite.endTime ?? 0) - (suite.startTime ?? 0);
	porCamada.set(camada, atual);
}

// A ordem é a da pirâmide de testes, não a alfabética: é assim que a suíte é
// pensada e é assim que se lê o relatório.
const ORDEM_CAMADAS = ["unit", "contract", "integration", "e2e"];
const posicao = (camada) => {
	const indice = ORDEM_CAMADAS.indexOf(camada);
	return indice === -1 ? ORDEM_CAMADAS.length : indice;
};
const camadas = [...porCamada.entries()].sort((a, b) => posicao(a[0]) - posicao(b[0]));

// --- cobertura ---------------------------------------------------------------
const METRICAS = [
	["statements", "Instruções"],
	["branches", "Ramos"],
	["functions", "Funções"],
	["lines", "Linhas"],
];

const limitesGlobais = metas().global ?? {};
const linhasCobertura = cobertura?.total
	? METRICAS.map(([chave, rotulo]) => {
			const pct = cobertura.total[chave]?.pct ?? NaN;
			const meta = limitesGlobais[chave];
			const situacao = meta === undefined ? "—" : pct >= meta ? `✅ ≥ ${meta}%` : `❌ meta ${meta}%`;
			return [rotulo, `${barra(pct)} ${pct.toFixed(1)}%`, situacao];
		})
	: [];

const abaixoDaMeta = linhasCobertura.some(([, , situacao]) => situacao.startsWith("❌"));

// --- falhas ------------------------------------------------------------------
const falhas = (resultados?.testResults ?? [])
	.flatMap((suite) =>
		(suite.assertionResults ?? [])
			.filter((teste) => teste.status === "failed")
			.map((teste) => ({
				arquivo: relative(dir, suite.name ?? ""),
				nome: teste.fullName ?? teste.title,
				motivo: (teste.failureMessages?.[0] ?? "").split("\n").slice(0, 3).join("\n"),
			}))
	)
	.slice(0, 20);

// --- publicação --------------------------------------------------------------
const situacao = args.resultado === "failure" || falharam > 0 ? "falha" : abaixoDaMeta ? "alerta" : "ok";

const corpo = [
	// Uma camada só não é tabela: repetiria o que o resumo já disse.
	camadas.length > 1
		? [
				"#### Por camada",
				"",
				tabela(
					["Camada", "Suítes", "Testes", "Falhas", "Duração"],
					camadas.map(([camada, dados]) => [
						`\`${celula(camada)}\``,
						String(dados.suites),
						String(dados.testes),
						dados.falhas ? `❌ ${dados.falhas}` : "—",
						duracao(dados.ms),
					])
				),
			].join("\n")
		: "",
	linhasCobertura.length
		? ["#### Cobertura", "", tabela(["Métrica", "Alcançado", "Meta do pacote"], linhasCobertura)].join("\n")
		: "_Sem relatório de cobertura — a execução não chegou ao fim._",
	falhas.length
		? [
				"#### Testes que falharam",
				"",
				falhas
					.map(
						(f) => `- **${celula(f.nome)}** — \`${celula(f.arquivo)}\`\n${recuar(["```", f.motivo, "```"].join("\n"))}`
					)
					.join("\n"),
			].join("\n")
		: "",
	args.log && existsSync(args.log)
		? recolhido("Saída do Jest", readFileSync(args.log, "utf8").split("\n").slice(-40).join("\n"))
		: "",
]
	.filter(Boolean)
	.join("\n\n");

const resumo =
	total === 0
		? "Nenhum teste executado — provavelmente a suíte nem chegou a iniciar."
		: `**${passaram}/${total}** testes passaram em ${suites} suítes · ${duracao(ms)}` +
			(falharam ? ` · **${falharam} falharam**` : "") +
			(pendentes ? ` · ${pendentes} pendentes` : "") +
			(cobertura?.total ? ` · linhas em **${cobertura.total.lines.pct.toFixed(1)}%**` : "");

publicar({
	id: `testes-${nome}`,
	ordem: Number(args.ordem ?? 30),
	titulo: `Testes · ${nome}`,
	situacao,
	resumo,
	corpo,
});
