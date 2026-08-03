/**
 * @module ci/comentar-pr
 *
 * Publica o relatório como **um** comentário no pull request, atualizado a cada
 * execução.
 *
 * Comentário novo por push transforma a conversa do PR em rolagem de robô e
 * empurra a revisão humana para fora da tela. O marcador oculto no corpo é como
 * a execução seguinte encontra o comentário anterior para editar.
 */

import { existsSync, readFileSync } from "node:fs";
import { argumentos } from "./lib/relatorio.mjs";

const args = argumentos();
const marcador = args.marcador ?? "bliss:relatorio-ci";
const token = process.env.GITHUB_TOKEN;
const repositorio = process.env.GITHUB_REPOSITORY;

/** Limite da API é 65536 caracteres; a folga cobre o aviso de truncamento. */
const LIMITE = 60000;

function encerrar(mensagem) {
	process.stdout.write(`${mensagem}\n`);
	process.exit(0);
}

if (!token || !repositorio) encerrar("sem GITHUB_TOKEN ou repositório — nada a comentar");
if (!args.arquivo || !existsSync(args.arquivo)) encerrar(`relatório não encontrado em ${args.arquivo}`);

/** Número do PR: vem do payload do evento, que é o único lugar confiável. */
function numeroDoPr() {
	if (args.pr) return Number(args.pr);
	const caminho = process.env.GITHUB_EVENT_PATH;
	if (!caminho || !existsSync(caminho)) return undefined;
	try {
		const evento = JSON.parse(readFileSync(caminho, "utf8"));
		return evento.pull_request?.number ?? evento.issue?.number;
	} catch {
		return undefined;
	}
}

const pr = numeroDoPr();
if (!pr) encerrar("execução fora de pull request — o relatório fica só no resumo do job");

let corpo = readFileSync(args.arquivo, "utf8");
if (corpo.length > LIMITE) {
	corpo = `${corpo.slice(0, LIMITE)}\n\n> _Relatório truncado. O documento completo está no artefato \`relatorio-final\` desta execução._\n`;
}
if (!corpo.includes(marcador)) corpo = `<!-- ${marcador} -->\n${corpo}`;

const cabecalhos = {
	authorization: `Bearer ${token}`,
	accept: "application/vnd.github+json",
	"content-type": "application/json",
	"x-github-api-version": "2022-11-28",
};

async function api(caminho, opcoes = {}) {
	const resposta = await fetch(`https://api.github.com${caminho}`, { ...opcoes, headers: cabecalhos });
	if (!resposta.ok)
		throw new Error(`${opcoes.method ?? "GET"} ${caminho} → ${resposta.status} ${await resposta.text()}`);
	return resposta.json();
}

const existentes = await api(`/repos/${repositorio}/issues/${pr}/comments?per_page=100`);
const anterior = existentes.find((comentario) => comentario.body?.includes(marcador));

if (anterior) {
	await api(`/repos/${repositorio}/issues/comments/${anterior.id}`, {
		method: "PATCH",
		body: JSON.stringify({ body: corpo }),
	});
	process.stdout.write(`comentário ${anterior.id} atualizado no PR #${pr}\n`);
} else {
	const criado = await api(`/repos/${repositorio}/issues/${pr}/comments`, {
		method: "POST",
		body: JSON.stringify({ body: corpo }),
	});
	process.stdout.write(`comentário ${criado.id} criado no PR #${pr}\n`);
}
