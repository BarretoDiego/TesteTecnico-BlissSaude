/**
 * @module ci/resumo-build
 *
 * Relatório de empacotamento de um microserviço.
 *
 * Além de "passou", registra **tamanho e sha256 do artefato**. O hash é o que
 * liga o zip verificado aqui ao zip publicado na Lambda: sem ele, "o deploy
 * subiu o quê?" só se responde por confiança na ordem dos jobs.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { argumentos, bytes, celula, duracao, publicar, recolhido, tabela } from "./lib/relatorio.mjs";

const args = argumentos();
const RAIZ = process.env.GITHUB_WORKSPACE ?? process.cwd();
const dir = isAbsolute(args.dir ?? "") ? args.dir : join(RAIZ, args.dir ?? ".");
const servico = args.servico ?? "serviço";
const artefato = join(dir, "dist", "function.zip");

const existe = existsSync(artefato);
const situacao = args.resultado === "failure" || !existe ? "falha" : "ok";

let tamanho = NaN;
let hash = "—";
if (existe) {
	tamanho = statSync(artefato).size;
	hash = createHash("sha256").update(readFileSync(artefato)).digest("hex");
}

const corpo = [
	tabela(
		["Artefato", "Tamanho", "sha256", "Duração"],
		[
			[
				`\`${celula(args.dir ?? "")}/dist/function.zip\``,
				existe ? bytes(tamanho) : "**ausente**",
				existe ? `\`${hash.slice(0, 16)}…\`` : "—",
				duracao(Number(args["duracao-ms"] ?? NaN)),
			],
		]
	),

	[
		"O build faz um `require` do bundle e confere que ele exporta `lambdaHandler`.",
		"Um import mal resolvido só falha ao executar, e descobrir isso como crash de",
		"cold start dentro da Lambda é um péssimo lugar para depurar.",
	].join("\n"),

	args.log && existsSync(args.log)
		? recolhido("Log do esbuild", readFileSync(args.log, "utf8").split("\n").slice(-30).join("\n"))
		: "",
]
	.filter(Boolean)
	.join("\n\n");

publicar({
	id: `build-${servico}`,
	ordem: Number(args.ordem ?? 40),
	titulo: `Empacotamento · ${servico}`,
	situacao,
	resumo: existe
		? `Artefato de ${bytes(tamanho)} · \`sha256:${hash.slice(0, 12)}…\``
		: "O artefato não foi gerado — o build não chegou ao fim.",
	corpo,
});
