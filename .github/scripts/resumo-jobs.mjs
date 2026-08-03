/**
 * @module ci/resumo-jobs
 *
 * Situação de cada job, direto do contexto `needs`.
 *
 * Existe por causa de um modo de falha real: um job pode ficar vermelho **sem**
 * que nenhum passo reportado tenha falhado — foi o que aconteceu quando o passo
 * `post` do cache do Node quebrou depois de todas as verificações passarem. O
 * relatório dizia "tudo certo" e a execução estava vermelha.
 *
 * Aqui a fonte é o resultado do job, não o do passo. As duas visões convivem: a
 * dos passos explica **o que** quebrou, esta garante que nada quebrou calado.
 */

import { argumentos, celula, publicar, situacaoDoResultado, SITUACOES, tabela } from "./lib/relatorio.mjs";

const args = argumentos();

let jobs = {};
try {
	jobs = JSON.parse(process.env.RESULTADOS ?? "{}");
} catch {
	jobs = {};
}

const linhas = Object.entries(jobs)
	.map(([nome, dados]) => ({ nome, resultado: dados?.result ?? "unknown" }))
	.sort((a, b) => a.nome.localeCompare(b.nome));

const falharam = linhas.filter((linha) => linha.resultado === "failure" || linha.resultado === "cancelled");
const pulados = linhas.filter((linha) => linha.resultado === "skipped");

publicar({
	id: "jobs",
	ordem: Number(args.ordem ?? 1),
	titulo: "Situação dos jobs",
	situacao: falharam.length > 0 ? "falha" : "ok",
	resumo:
		linhas.length === 0
			? "Sem informação de jobs — o contexto `needs` chegou vazio."
			: `${linhas.length - falharam.length - pulados.length} concluíram · ${falharam.length} falharam · ${pulados.length} não se aplicaram`,
	corpo: [
		tabela(
			["Job", "Resultado"],
			linhas.map((linha) => {
				const situacao = situacaoDoResultado(linha.resultado);
				return [`\`${celula(linha.nome)}\``, `${SITUACOES[situacao].icone} ${celula(linha.resultado)}`];
			})
		),
		falharam.length > 0
			? [
					"",
					"> [!NOTE]",
					"> Um job pode falhar fora dos passos que reportam — cache, upload, limite de",
					"> tempo. Quando a etapa correspondente aparecer verde na tabela acima e o job",
					"> vermelho aqui, a causa está na infraestrutura da execução, não no código.",
				].join("\n")
			: "",
	]
		.filter(Boolean)
		.join("\n"),
});
