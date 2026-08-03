/**
 * Conversão de linha do banco para DTO.
 *
 * É a fronteira onde `Date` do driver vira string ISO e onde o hash de senha
 * precisa ficar para trás. Duas classes de falha justificam a suíte: um campo
 * novo que ninguém mapeou (some da API sem erro) e um campo sensível que
 * atravessa (vaza sem erro). As duas são silenciosas.
 */

import type { RequestEventRow, RequestRow } from "../src/schema/requests.schema";
import type { UserRow } from "../src/schema/users.schema";
import { toAuthenticatedUser, toRequestDto, toRequestEventDto } from "../src/mappers";

const CRIADA_EM = new Date("2026-07-30T12:00:00.000Z");
const ATUALIZADA_EM = new Date("2026-07-31T09:30:00.000Z");

function makeRequestRow(overrides: Partial<RequestRow> = {}): RequestRow {
	return {
		id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		title: "Beneficiária sem acesso ao aplicativo",
		description: "Login retorna erro após a troca de senha.",
		priority: "high",
		status: "open",
		createdBy: "ana@saudebliss.test",
		reviewedBy: null,
		reviewedAt: null,
		createdTraceId: "trace-1",
		createdAt: CRIADA_EM,
		updatedAt: ATUALIZADA_EM,
		...overrides,
	} as RequestRow;
}

describe("toRequestDto", () => {
	it("converte as datas para string ISO", () => {
		// O DTO atravessa JSON. Deixar `Date` aqui faria cada consumidor decidir
		// como serializar, e o formato variaria entre rotas.
		const dto = toRequestDto(makeRequestRow());

		expect(dto.createdAt).toBe("2026-07-30T12:00:00.000Z");
		expect(dto.updatedAt).toBe("2026-07-31T09:30:00.000Z");
	});

	it("mantém `reviewedAt` nulo quando não houve conferência", () => {
		// `null` e não `undefined`: o contrato declara `nullable`, e `undefined`
		// sumiria do JSON — o cliente não distinguiria "não conferida" de "campo
		// que a API esqueceu".
		expect(toRequestDto(makeRequestRow()).reviewedAt).toBeNull();
	});

	it("converte `reviewedAt` quando houve conferência", () => {
		const revisadaEm = new Date("2026-08-01T10:00:00.000Z");
		const dto = toRequestDto(makeRequestRow({ reviewedAt: revisadaEm, reviewedBy: "daniel@saudebliss.test" }));

		expect(dto.reviewedAt).toBe("2026-08-01T10:00:00.000Z");
		expect(dto.reviewedBy).toBe("daniel@saudebliss.test");
	});

	it("preserva o trace da criação", () => {
		// É o elo entre a linha do banco, o envelope e as linhas de log.
		expect(toRequestDto(makeRequestRow({ createdTraceId: "trace-xyz" })).createdTraceId).toBe("trace-xyz");
	});

	it("aceita trace ausente", () => {
		// Linhas do seed não passaram por requisição HTTP e não têm trace.
		expect(toRequestDto(makeRequestRow({ createdTraceId: null })).createdTraceId).toBeNull();
	});

	it("expõe exatamente os campos do contrato", () => {
		// Trava as duas direções: um campo novo no schema que ninguém mapeou some
		// da API; um campo interno que vazasse apareceria aqui.
		expect(Object.keys(toRequestDto(makeRequestRow())).sort()).toEqual(
			[
				"createdAt",
				"createdBy",
				"createdTraceId",
				"description",
				"id",
				"priority",
				"reviewedAt",
				"reviewedBy",
				"status",
				"title",
				"updatedAt",
			].sort()
		);
	});

	it.each(["open", "in_review", "reviewed", "rejected"] as const)("repassa o status %s sem traduzir", (status) => {
		// Tradução é da camada de apresentação. Traduzir aqui quebraria o filtro,
		// que compara com o valor cru.
		expect(toRequestDto(makeRequestRow({ status })).status).toBe(status);
	});

	it.each(["low", "medium", "high", "critical"] as const)("repassa a prioridade %s", (priority) => {
		expect(toRequestDto(makeRequestRow({ priority })).priority).toBe(priority);
	});

	it("não muta a linha recebida", () => {
		const row = makeRequestRow();
		const copia = { ...row };

		toRequestDto(row);

		expect(row).toEqual(copia);
		expect(row.createdAt).toBeInstanceOf(Date);
	});
});

describe("toRequestEventDto", () => {
	function makeEventRow(overrides: Partial<RequestEventRow> = {}): RequestEventRow {
		return {
			id: "8f14e45f-ceea-467a-9cbe-9e6b1c9a1f2b",
			requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
			type: "created",
			fromStatus: null,
			toStatus: "open",
			actor: "ana@saudebliss.test",
			traceId: "trace-1",
			createdAt: CRIADA_EM,
			...overrides,
		} as RequestEventRow;
	}

	it("converte a data do evento", () => {
		expect(toRequestEventDto(makeEventRow()).createdAt).toBe("2026-07-30T12:00:00.000Z");
	});

	it("mantém `fromStatus` nulo na criação", () => {
		// Criação não tem origem. A tela usa isso para não desenhar uma seta
		// partindo do nada.
		expect(toRequestEventDto(makeEventRow()).fromStatus).toBeNull();
	});

	it("preserva a transição quando houve", () => {
		const dto = toRequestEventDto(makeEventRow({ type: "status_changed", fromStatus: "open", toStatus: "reviewed" }));

		expect(dto).toMatchObject({ fromStatus: "open", toStatus: "reviewed", type: "status_changed" });
	});

	it("aceita ator e trace ausentes", () => {
		// Evento gerado por rotina de manutenção não tem pessoa nem requisição.
		const dto = toRequestEventDto(makeEventRow({ actor: null, traceId: null }));

		expect(dto.actor).toBeNull();
		expect(dto.traceId).toBeNull();
	});

	it("expõe exatamente os campos do contrato", () => {
		expect(Object.keys(toRequestEventDto(makeEventRow())).sort()).toEqual(
			["actor", "createdAt", "fromStatus", "id", "requestId", "toStatus", "traceId", "type"].sort()
		);
	});

	it("liga o evento à solicitação", () => {
		const dto = toRequestEventDto(makeEventRow({ requestId: "outra-solicitacao" }));

		expect(dto.requestId).toBe("outra-solicitacao");
	});
});

describe("toAuthenticatedUser", () => {
	function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
		return {
			id: "161847b0-900d-4569-80a1-0fc6aac59e1a",
			email: "daniel@saudebliss.test",
			name: "Daniel Morais",
			passwordHash: "scrypt$32768$8$1$c2FsdA$aGFzaA",
			roles: ["admin", "reviewer"],
			active: true,
			lastLoginAt: null,
			createdAt: CRIADA_EM,
			updatedAt: ATUALIZADA_EM,
			...overrides,
		} as UserRow;
	}

	it("devolve a identidade pública", () => {
		expect(toAuthenticatedUser(makeUserRow())).toEqual({
			id: "161847b0-900d-4569-80a1-0fc6aac59e1a",
			email: "daniel@saudebliss.test",
			name: "Daniel Morais",
			roles: ["admin", "reviewer"],
		});
	});

	it("nunca carrega o hash da senha", () => {
		// A garantia principal é de tipo — o retorno não tem o campo —, mas a
		// asserção em runtime cobre o dia em que alguém alargar o tipo.
		const publico = toAuthenticatedUser(makeUserRow());

		expect(publico).not.toHaveProperty("passwordHash");
		expect(JSON.stringify(publico)).not.toContain("scrypt");
	});

	it("não expõe o status da conta", () => {
		// `active` é decisão do serviço de autenticação, não informação do cliente:
		// devolvê-lo transformaria o perfil num oráculo de contas desativadas.
		expect(toAuthenticatedUser(makeUserRow({ active: false }))).not.toHaveProperty("active");
	});

	it("não expõe datas internas", () => {
		const publico = toAuthenticatedUser(makeUserRow({ lastLoginAt: CRIADA_EM }));

		expect(publico).not.toHaveProperty("lastLoginAt");
		expect(publico).not.toHaveProperty("createdAt");
	});

	it("expõe exatamente os campos do contrato", () => {
		expect(Object.keys(toAuthenticatedUser(makeUserRow())).sort()).toEqual(["email", "id", "name", "roles"]);
	});

	it("preserva lista de perfis vazia", () => {
		// Autenticado sem autorização é estado legítimo, e virar `undefined` faria
		// o front quebrar ao iterar.
		expect(toAuthenticatedUser(makeUserRow({ roles: [] })).roles).toEqual([]);
	});
});
