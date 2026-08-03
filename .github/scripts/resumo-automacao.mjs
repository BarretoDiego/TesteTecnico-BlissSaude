/**
 * @module ci/resumo-automacao
 *
 * Relatório da suíte Playwright de conferência.
 *
 * Reporta o instável (`flaky`) separado do que passou. Somar os dois esconde
 * exatamente o sintoma que precede uma suíte em que ninguém confia mais.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { argumentos, celula, duracao, publicar, recolhido, recuar, tabela } from "./lib/relatorio.mjs";

const args = argumentos();
const RAIZ = process.env.GITHUB_WORKSPACE ?? process.cwd();
const arquivo = isAbsolute(args.arquivo ?? "") ? args.arquivo : join(RAIZ, args.arquivo ?? "");

function lerJson(caminho) {
	if (!caminho || !existsSync(caminho)) return undefined;
	try {
		return JSON.parse(readFileSync(caminho, "utf8"));
	} catch {
		return undefined;
	}
}

const relatorio = lerJson(arquivo);
const stats = relatorio?.stats ?? {};

/** Percorre a árvore de suítes e devolve os testes em lista plana. */
function achatar(suites = [], caminho = []) {
	return suites.flatMap((suite) => [
		...(suite.specs ?? []).map((spec) => ({
			titulo: [...caminho, suite.title, spec.title].filter(Boolean).join(" › "),
			arquivo: spec.file ?? suite.file,
			ok: spec.ok,
			testes: spec.tests ?? [],
		})),
		...achatar(suite.suites ?? [], [...caminho, suite.title]),
	]);
}

const specs = achatar(relatorio?.suites ?? []);
const falhos = specs.filter((spec) => !spec.ok);

const esperados = stats.expected ?? 0;
const inesperados = stats.unexpected ?? 0;
const instaveis = stats.flaky ?? 0;
const pulados = stats.skipped ?? 0;

const situacao =
	args.resultado === "failure" || inesperados > 0 ? "falha" : instaveis > 0 ? "alerta" : relatorio ? "ok" : "falha";

const corpo = [
	tabela(
		["Resultado", "Quantidade"],
		[
			["✅ passaram", String(esperados)],
			["❌ falharam", String(inesperados)],
			["⚠️ instáveis (passaram na retentativa)", String(instaveis)],
			["⏭️ pulados", String(pulados)],
		]
	),

	instaveis > 0
		? [
				"> [!WARNING]",
				"> Teste instável passa na segunda tentativa e some do resultado. É o começo",
				"> de uma suíte em que ninguém confia — trate como falha adiada, não como verde.",
			].join("\n")
		: "",

	falhos.length
		? [
				"#### Cenários que falharam",
				"",
				falhos
					.slice(0, 15)
					.map((spec) => {
						const erro = spec.testes?.[0]?.results?.[0]?.error?.message ?? "";
						const primeiraLinha = erro.split("\n").slice(0, 4).join("\n");
						const bloco = primeiraLinha ? `\n${recuar(["```", primeiraLinha, "```"].join("\n"))}` : "";
						return `- **${celula(spec.titulo)}** — \`${celula(spec.arquivo)}\`${bloco}`;
					})
					.join("\n"),
			].join("\n")
		: "",

	[
		"O relatório HTML, os traces e o CSV operacional da conferência ficam nos",
		"artefatos desta execução — o trace abre no `npx playwright show-trace`.",
	].join("\n"),

	args.log && existsSync(args.log)
		? recolhido("Saída do Playwright", readFileSync(args.log, "utf8").split("\n").slice(-40).join("\n"))
		: "",
]
	.filter(Boolean)
	.join("\n\n");

publicar({
	id: "automacao",
	ordem: Number(args.ordem ?? 70),
	titulo: "Automação da conferência (Playwright)",
	situacao,
	resumo: relatorio
		? `${esperados} cenários passaram · ${inesperados} falharam · ${instaveis} instáveis · ${duracao(stats.duration ?? NaN)}`
		: "A suíte não produziu relatório — provavelmente não chegou a iniciar.",
	corpo,
});
