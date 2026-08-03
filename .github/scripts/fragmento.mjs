/**
 * @module ci/fragmento
 *
 * Fragmento genérico, para etapas cujo resultado é "passou ou não passou".
 *
 * Formatação, paridade de rotas, validação do Terraform, build do backoffice:
 * todas produzem log e um código de saída. Um script por etapa seria quatro
 * cópias do mesmo `if`; este cobre todas e reserva os scripts dedicados para as
 * etapas que têm dado estruturado a extrair (testes, cobertura, plano).
 *
 * Uso:
 *   node .github/scripts/fragmento.mjs \
 *     --id formato --ordem 10 --titulo "Formatação" \
 *     --resultado "${{ steps.x.outcome }}" --log "$RUNNER_TEMP/x.log" \
 *     --resumo-ok "Tudo formatado." --resumo-falha "Rode `pnpm format`."
 */

import { existsSync, readFileSync } from "node:fs";
import { argumentos, cauda, publicar, recolhido, situacaoDoResultado } from "./lib/relatorio.mjs";

const args = argumentos();

const situacao = args.situacao ?? situacaoDoResultado(args.resultado ?? "success");
const log = args.log && existsSync(args.log) ? readFileSync(args.log, "utf8") : "";
const linhas = Number(args["linhas-do-log"] ?? (situacao === "falha" ? 60 : 20));

const resumo =
	situacao === "falha"
		? (args["resumo-falha"] ?? args.resumo ?? "A etapa falhou — o log abaixo tem o fim da execução.")
		: situacao === "pulado"
			? (args["resumo-pulado"] ?? "Etapa não executada neste contexto.")
			: (args["resumo-ok"] ?? args.resumo ?? "Etapa concluída.");

// Texto longo mora em arquivo, não em YAML: prosa dentro de um bloco `run:`
// depende de recuo e de escape de shell, e quebra o workflow inteiro na
// primeira linha esquecida.
const detalhe =
	args["detalhe-arquivo"] && existsSync(args["detalhe-arquivo"])
		? readFileSync(args["detalhe-arquivo"], "utf8")
		: (args.detalhe ?? "");

const corpo = [
	detalhe,
	// Em execução verde o log entra recolhido e curto: serve de prova de que a
	// etapa rodou de fato, sem competir por atenção com o que falhou.
	recolhido(situacao === "falha" ? "Log da falha" : "Log", cauda(log, linhas)),
]
	.filter(Boolean)
	.join("\n\n");

publicar({
	id: args.id,
	ordem: Number(args.ordem ?? 50),
	titulo: args.titulo ?? args.id,
	situacao,
	resumo,
	corpo,
});
