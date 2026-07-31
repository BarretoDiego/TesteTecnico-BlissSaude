/**
 * @module database/mappers
 *
 * Conversão de linha do banco para DTO da API.
 *
 * Vive aqui, e não em um microserviço, porque o mapeamento é acoplado ao
 * **schema** — muda quando uma coluna muda. Duplicá-lo por serviço garantiria
 * que um deles ficasse para trás na próxima migration.
 *
 * As queries seguem sendo de cada serviço: mapper é schema, query é domínio.
 */

import type { AuthenticatedUser, Request as RequestDto, RequestEvent as RequestEventDto } from "@saude-bliss/contracts";
import type { RequestEventRow, RequestRow } from "./schema/requests.schema";
import type { UserRow } from "./schema/users.schema";

/**
 * `Date` vira string ISO já aqui, no limite da persistência, para que nenhuma
 * camada acima precise saber que o driver do Postgres devolve objetos `Date`.
 */
export function toRequestDto(row: RequestRow): RequestDto {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		priority: row.priority,
		status: row.status,
		createdBy: row.createdBy,
		reviewedBy: row.reviewedBy,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdTraceId: row.createdTraceId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function toRequestEventDto(row: RequestEventRow): RequestEventDto {
	return {
		id: row.id,
		requestId: row.requestId,
		type: row.type,
		fromStatus: row.fromStatus,
		toStatus: row.toStatus,
		actor: row.actor,
		traceId: row.traceId,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Usuário na forma pública.
 *
 * O `passwordHash` fica de fora **por construção**: o tipo de saída não tem o
 * campo, então expô-lo por engano vira erro de compilação e não incidente.
 */
export function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		roles: row.roles,
	};
}
