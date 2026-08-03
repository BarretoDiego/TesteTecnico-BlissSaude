/**
 * @module ci/resumo-terraform
 *
 * Traduz um plano do Terraform (`terraform show -json`) para leitura humana.
 *
 * O plano em texto tem centenas de linhas e enterra a única informação que
 * decide a aprovação: **o que vai ser destruído**. Aqui isso aparece primeiro,
 * em destaque, e o plano completo fica recolhido logo abaixo.
 */

import { existsSync, readFileSync } from "node:fs";
import { argumentos, celula, publicar, recolhido, tabela } from "./lib/relatorio.mjs";

const args = argumentos();

function lerJson(caminho) {
	if (!caminho || !existsSync(caminho)) return undefined;
	try {
		return JSON.parse(readFileSync(caminho, "utf8"));
	} catch {
		return undefined;
	}
}

const plano = lerJson(args.plano);
const mudancas = (plano?.resource_changes ?? []).filter((r) => !r.change?.actions?.includes("no-op"));

const classificar = (acoes = []) => {
	if (acoes.includes("delete") && acoes.includes("create")) return "recriar";
	if (acoes.includes("delete")) return "destruir";
	if (acoes.includes("create")) return "criar";
	if (acoes.includes("update")) return "alterar";
	return "outro";
};

const grupos = { criar: [], alterar: [], recriar: [], destruir: [], outro: [] };
for (const mudanca of mudancas) grupos[classificar(mudanca.change?.actions)].push(mudanca.address);

/**
 * Recriações rotineiras desta arquitetura.
 *
 * O deployment do API Gateway é recriado a cada mudança de rota **por
 * definição** — é assim que uma nova versão entra no stage. Marcá-lo como
 * perigoso faria o aviso aparecer em todo deploy, e aviso que aparece sempre
 * deixa de ser lido justamente no dia em que importa.
 */
const RECRIACAO_ROTINEIRA = ["aws_api_gateway_deployment"];
const tipoDe = (endereco) => endereco.split(".").filter((parte) => parte.startsWith("aws_"))[0] ?? endereco;

const recriacoesSensiveis = grupos.recriar.filter((endereco) => !RECRIACAO_ROTINEIRA.includes(tipoDe(endereco)));
const perigosas = [...grupos.destruir, ...recriacoesSensiveis];
const totalMudancas = mudancas.length;

// Um plano vazio é o resultado desejado em reexecução — significa que o estado
// já bate com o código. Só é surpresa quando se esperava mudança.
const situacao =
	args.resultado === "failure" ? "falha" : plano === undefined ? "alerta" : perigosas.length > 0 ? "alerta" : "ok";

const ICONES = { criar: "🟢", alterar: "🟡", recriar: "🟠", destruir: "🔴", outro: "⚪" };

const corpo = [
	tabela(
		["Ação", "Recursos"],
		Object.entries(grupos)
			.filter(([, lista]) => lista.length > 0)
			.map(([acao, lista]) => [`${ICONES[acao]} ${acao}`, String(lista.length)])
	),

	perigosas.length > 0
		? [
				"> [!WARNING]",
				"> Este plano **remove ou recria** recurso com estado. Confira os endereços",
				"> abaixo antes de aprovar — recriar banco, API ou segredo não tem desfazer.",
				">",
				...perigosas.map((endereco) => `> - \`${celula(endereco)}\``),
			].join("\n")
		: "",

	...Object.entries(grupos)
		.filter(([, lista]) => lista.length > 0)
		.map(([acao, lista]) =>
			[`#### ${ICONES[acao]} ${acao}`, "", ...lista.map((endereco) => `- \`${celula(endereco)}\``)].join("\n")
		),

	args.log && existsSync(args.log) ? recolhido("Plano completo (texto)", readFileSync(args.log, "utf8"), "hcl") : "",
]
	.filter(Boolean)
	.join("\n\n");

const resumo =
	plano === undefined
		? "Não foi possível ler o plano — veja o log da etapa."
		: totalMudancas === 0
			? "Nenhuma mudança: o estado já corresponde ao código."
			: `${grupos.criar.length} a criar · ${grupos.alterar.length} a alterar · ${grupos.recriar.length} a recriar · **${grupos.destruir.length} a destruir**`;

publicar({
	id: args.id ?? "terraform-plano",
	ordem: Number(args.ordem ?? 60),
	titulo: args.titulo ?? `Plano do Terraform${args.ambiente ? ` · ${args.ambiente}` : ""}`,
	situacao,
	resumo,
	corpo,
});
