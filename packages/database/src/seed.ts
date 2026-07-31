/**
 * @module api/db/seed
 *
 * Popula o banco com solicitações de demonstração.
 *
 * Dá ao avaliador uma tela de conferência com conteúdo já no primeiro acesso, e
 * ao backoffice dados suficientes para exercitar filtros e paginação.
 *
 * Os dados são determinísticos de propósito — sem faker, sem aleatoriedade. Um
 * seed reproduzível permite que a suíte Playwright faça asserções sobre contagens
 * conhecidas. A automação cria os próprios dados para os testes de escrita; este
 * seed é o pano de fundo.
 */

import { loadDatabaseEnv } from "./env";

// Antes de qualquer import do client: ele lê `process.env` no carregamento.
loadDatabaseEnv();

import type { RequestPriority, RequestStatus, UserRole } from "@saude-bliss/contracts";
import { passwordService } from "@saude-bliss/core";
import { closeDb, getDb } from "./client";
import { requestEvents, requests } from "./schema/requests.schema";
import { users } from "./schema/users.schema";

interface SeedRequest {
	title: string;
	description: string;
	priority: RequestPriority;
	status: RequestStatus;
	createdBy: string;
	reviewedBy?: string;
}

const SEED: readonly SeedRequest[] = [
	{
		title: "Agendamento não confirmado após pagamento",
		description:
			"Beneficiária concluiu o pagamento da consulta mas não recebeu a confirmação do agendamento por e-mail nem no aplicativo.",
		priority: "high",
		status: "open",
		createdBy: "ana.souza@saudebliss.test",
	},
	{
		title: "Divergência no valor do procedimento",
		description:
			"O valor cobrado no checkout ficou acima da tabela vigente para o procedimento de fundoscopia. Verificar tabela de preços.",
		priority: "critical",
		status: "open",
		createdBy: "ana.souza@saudebliss.test",
	},
	{
		title: "Solicitação de segunda via de carteirinha",
		description: "Beneficiário perdeu a carteirinha física e solicita emissão de segunda via digital.",
		priority: "low",
		status: "open",
		createdBy: "bruno.lima@saudebliss.test",
	},
	{
		title: "Atualizar rede credenciada da região Sul",
		description:
			"Três clínicas encerraram o contrato e continuam aparecendo na busca de rede credenciada do aplicativo.",
		priority: "medium",
		status: "in_review",
		createdBy: "bruno.lima@saudebliss.test",
	},
	{
		title: "Erro ao anexar laudo no aplicativo",
		description:
			"Ao anexar um laudo em PDF acima de 5MB o aplicativo exibe erro genérico e não conclui o envio do documento.",
		priority: "high",
		status: "in_review",
		createdBy: "carla.mendes@saudebliss.test",
	},
	{
		title: "Reembolso pendente há mais de 30 dias",
		description:
			"Solicitação de reembolso protocolada há 32 dias segue sem retorno. Beneficiária já entrou em contato duas vezes.",
		priority: "critical",
		status: "reviewed",
		createdBy: "carla.mendes@saudebliss.test",
		reviewedBy: "daniel.morais@saudebliss.test",
	},
	{
		title: "Cadastro duplicado de dependente",
		description: "O mesmo dependente aparece duas vezes na listagem do titular, com CPFs iguais.",
		priority: "medium",
		status: "reviewed",
		createdBy: "ana.souza@saudebliss.test",
		reviewedBy: "daniel.morais@saudebliss.test",
	},
	{
		title: "Teste de carga do ambiente de homologação",
		description: "Solicitação aberta por engano durante teste interno de carga. Pode ser descartada.",
		priority: "low",
		status: "rejected",
		createdBy: "bruno.lima@saudebliss.test",
		reviewedBy: "daniel.morais@saudebliss.test",
	},
];

/**
 * Usuários de demonstração.
 *
 * Senha única e óbvia de propósito: é ambiente local, e uma senha "esperta" só
 * faria o avaliador perder tempo procurando onde ela está escrita. O hash é
 * derivado no seed, nunca versionado — commitar hash de senha, mesmo de
 * desenvolvimento, ensina o hábito errado.
 */
const SEED_PASSWORD = "saudebliss123";

interface SeedUser {
	email: string;
	name: string;
	roles: UserRole[];
	active?: boolean;
}

const SEED_USERS: readonly SeedUser[] = [
	{ email: "daniel.morais@saudebliss.test", name: "Daniel Morais", roles: ["admin", "reviewer"] },
	{ email: "ana.souza@saudebliss.test", name: "Ana Souza", roles: ["requester"] },
	{ email: "bruno.lima@saudebliss.test", name: "Bruno Lima", roles: ["requester"] },
	{ email: "carla.mendes@saudebliss.test", name: "Carla Mendes", roles: ["reviewer"] },
	// Desativado de propósito: exercita o 403 do login sem precisar mexer no banco.
	{ email: "inativo@saudebliss.test", name: "Usuário Inativo", roles: ["requester"], active: false },
];

async function main(): Promise<void> {
	const db = await getDb();

	// Idempotente: rodar de novo recria o mesmo estado em vez de duplicar.
	// O `delete` em `requests` já limpa `request_events` pelo cascade da FK.
	console.log("limpando dados existentes...");
	await db.delete(requestEvents);
	await db.delete(requests);
	// `refresh_tokens` cai junto pelo cascade da FK.
	await db.delete(users);

	console.log(`inserindo ${SEED_USERS.length} usuários...`);
	// A derivação é intencionalmente lenta (~100ms cada), então roda em paralelo:
	// serializar cinco delas somaria meio segundo sem nenhum motivo.
	const hashes = await Promise.all(SEED_USERS.map(() => passwordService.hash(SEED_PASSWORD)));

	await db.insert(users).values(
		SEED_USERS.map((user, index) => ({
			email: user.email,
			name: user.name,
			roles: user.roles,
			active: user.active ?? true,
			passwordHash: hashes[index]!,
		}))
	);

	console.log(`inserindo ${SEED.length} solicitações...`);
	for (const item of SEED) {
		const isReviewed = item.status === "reviewed" || item.status === "rejected";
		const traceId = `seed-${item.createdBy.split("@")[0]}`;

		const [row] = await db
			.insert(requests)
			.values({
				title: item.title,
				description: item.description,
				priority: item.priority,
				status: item.status,
				createdBy: item.createdBy,
				reviewedBy: item.reviewedBy ?? null,
				reviewedAt: isReviewed ? new Date() : null,
				createdTraceId: traceId,
			})
			.returning();

		if (!row) throw new Error(`falha ao inserir a solicitação "${item.title}"`);

		// Toda solicitação tem o evento de criação: a tela de detalhe assume que a
		// linha do tempo nunca está vazia.
		await db.insert(requestEvents).values({
			requestId: row.id,
			type: "created",
			fromStatus: null,
			toStatus: "open",
			actor: item.createdBy,
			traceId,
		});

		if (item.status !== "open") {
			await db.insert(requestEvents).values({
				requestId: row.id,
				type: isReviewed ? "reviewed" : "status_changed",
				fromStatus: "open",
				toStatus: item.status,
				actor: item.reviewedBy ?? item.createdBy,
				traceId,
			});
		}
	}

	const byStatus = SEED.reduce<Record<string, number>>((acc, item) => {
		acc[item.status] = (acc[item.status] ?? 0) + 1;
		return acc;
	}, {});

	console.log("seed concluído:", byStatus);
	console.log(`usuários: ${SEED_USERS.length} (senha de todos: ${SEED_PASSWORD})`);
	await closeDb();
}

main().catch(async (error) => {
	console.error("falha no seed:", error);
	await closeDb();
	process.exit(1);
});
