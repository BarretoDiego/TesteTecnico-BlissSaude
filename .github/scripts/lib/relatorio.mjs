/**
 * @module ci/lib/relatorio
 *
 * Vocabulário comum dos relatórios do pipeline.
 *
 * Cada job escreve um **fragmento**: um pedaço de markdown com um cabeçalho
 * legível por máquina. O job de consolidação lê todos os fragmentos e monta o
 * documento final — tabela de situação no topo, detalhe de cada etapa embaixo.
 *
 * A alternativa seria cada job despejar log cru no resumo do GitHub. Log cru é
 * o que já existe na aba de execução; o que falta em pipeline é a leitura de
 * uma tela só que responde "passou?", "onde parou?" e "o que mudou?".
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Situações possíveis de uma etapa, em ordem de gravidade. */
export const SITUACOES = {
	ok: { icone: "✅", rotulo: "passou", peso: 0 },
	alerta: { icone: "⚠️", rotulo: "atenção", peso: 1 },
	pulado: { icone: "⏭️", rotulo: "pulado", peso: 0 },
	falha: { icone: "❌", rotulo: "falhou", peso: 2 },
};

/** Traduz o `outcome`/`result` de um passo ou job do GitHub para a situação. */
export function situacaoDoResultado(resultado) {
	switch (resultado) {
		case "success":
			return "ok";
		case "skipped":
			return "pulado";
		case "cancelled":
			return "alerta";
		default:
			return "falha";
	}
}

/** Duração humana. Segundos abaixo de um minuto, `m s` acima. */
export function duracao(ms) {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	if (ms < 1000) return "<1s";
	const segundos = Math.round(ms / 1000);
	if (segundos < 60) return `${segundos}s`;
	return `${Math.floor(segundos / 60)}m ${String(segundos % 60).padStart(2, "0")}s`;
}

/** Tamanho legível. Lambda cobra por artefato, então o número importa. */
export function bytes(n) {
	if (!Number.isFinite(n)) return "—";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Barra de progresso em texto.
 *
 * Cobertura em número exige comparar mentalmente com a meta; a barra mostra a
 * distância de relance, que é o que se quer ao passar o olho num relatório.
 */
export function barra(pct, largura = 10) {
	if (!Number.isFinite(pct)) return "—";
	const cheias = Math.round((Math.max(0, Math.min(100, pct)) / 100) * largura);
	return `${"█".repeat(cheias)}${"░".repeat(largura - cheias)}`;
}

/** Tabela markdown. Alinhamento à esquerda — número alinhado à direita ilude. */
export function tabela(cabecalho, linhas) {
	if (linhas.length === 0) return "_(sem itens)_";
	const separador = cabecalho.map(() => "---");
	return [cabecalho, separador, ...linhas].map((linha) => `| ${linha.join(" | ")} |`).join("\n");
}

/**
 * Bloco recolhido.
 *
 * Log inteiro no corpo do relatório afoga a informação; log ausente obriga a
 * abrir a execução do GitHub. O `<details>` resolve os dois.
 */
export function recolhido(titulo, conteudo, linguagem = "") {
	if (!conteudo || !conteudo.trim()) return "";
	return [
		`<details><summary>${titulo}</summary>`,
		"",
		`\`\`\`${linguagem}`,
		conteudo.trimEnd(),
		"```",
		"",
		"</details>",
	].join("\n");
}

/**
 * Recua um bloco.
 *
 * Bloco de código dentro de item de lista precisa do mesmo recuo do item, senão
 * o markdown fecha a lista e a mensagem de erro vaza para fora dela.
 */
export function recuar(texto, espacos = 2) {
	const prefixo = " ".repeat(espacos);
	return texto
		.split("\n")
		.map((linha) => `${prefixo}${linha}`)
		.join("\n");
}

/** Últimas `n` linhas de um texto — o fim do log é onde está a causa. */
export function cauda(texto, n = 40) {
	if (!texto) return "";
	const linhas = texto.replace(/\r/g, "").split("\n");
	return linhas.slice(-n).join("\n");
}

/** Escapa `|` para não quebrar a tabela markdown. */
export function celula(valor) {
	return String(valor ?? "—")
		.replace(/\|/g, "\\|")
		.replace(/\n+/g, " ");
}

/**
 * Publica um fragmento.
 *
 * Escreve três destinos de uma vez: o arquivo que a consolidação vai ler, o
 * resumo do job no GitHub (que é onde a pessoa olha primeiro) e a saída padrão
 * (que é onde se olha ao rodar o script na máquina).
 */
export function publicar({ id, ordem = 50, titulo, situacao = "ok", resumo = "", corpo = "" }) {
	const meta = { id, ordem, titulo, situacao, resumo };
	const cabecalho = `<!-- bliss:etapa ${JSON.stringify(meta)} -->`;
	const icone = SITUACOES[situacao]?.icone ?? "•";

	const markdown = [cabecalho, `### ${icone} ${titulo}`, "", resumo, "", corpo.trimEnd(), ""].join("\n");

	const destino = process.env.RELATORIO_DIR ?? join(process.env.GITHUB_WORKSPACE ?? process.cwd(), "relatorio");
	mkdirSync(destino, { recursive: true });
	// Prefixo numérico para a consolidação ordenar por nome de arquivo, sem
	// precisar ler e reordenar tudo em memória.
	const arquivo = join(destino, `${String(ordem).padStart(3, "0")}-${id}.md`);
	writeFileSync(arquivo, markdown, "utf8");

	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");

	process.stdout.write(`${markdown}\n`);
	return arquivo;
}

/** Leitor de argumentos `--chave valor`. Sem dependência, sem surpresa. */
export function argumentos(argv = process.argv.slice(2)) {
	const resultado = {};
	for (let i = 0; i < argv.length; i += 1) {
		const item = argv[i];
		if (!item.startsWith("--")) continue;
		const chave = item.slice(2);
		const proximo = argv[i + 1];
		if (proximo === undefined || proximo.startsWith("--")) {
			resultado[chave] = "true";
		} else {
			resultado[chave] = proximo;
			i += 1;
		}
	}
	return resultado;
}

/** Grava um par `chave=valor` na saída do passo, com suporte a multilinha. */
export function saidaDoPasso(chave, valor) {
	if (!process.env.GITHUB_OUTPUT) return;
	const delimitador = `bliss_${Math.random().toString(36).slice(2)}`;
	appendFileSync(process.env.GITHUB_OUTPUT, `${chave}<<${delimitador}\n${valor}\n${delimitador}\n`, "utf8");
}
