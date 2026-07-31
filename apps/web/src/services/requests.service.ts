/**
 * @module web/services/requests.service
 *
 * Chamadas aos microserviços `bliss-requests` e `bliss-reviews`.
 *
 * Tipado ponta a ponta contra `@saude-bliss/contracts`: uma mudança de schema na
 * API quebra o build do backoffice em vez de virar erro em runtime.
 */

import type {
	CreateRequestPayload,
	ListRequestsQueryPayload,
	ListRequestsResult,
	RequestDetail,
	Request as RequestDto,
	ReviewRequestPayload,
} from "@saude-bliss/contracts";
import { apiClient } from "./instances";

export class RequestsService {
	static async list(query: Partial<ListRequestsQueryPayload> = {}): Promise<ListRequestsResult> {
		const { data } = await apiClient.get<ListRequestsResult>("/requests", { params: query });
		return data;
	}

	static async getById(id: string): Promise<RequestDetail> {
		const { data } = await apiClient.get<RequestDetail>(`/requests/${id}`);
		return data;
	}

	static async create(payload: CreateRequestPayload): Promise<RequestDto> {
		const { data } = await apiClient.post<RequestDto>("/requests", payload);
		return data;
	}

	/** Conferência — outro microserviço, outro prefixo. */
	static async review(id: string, payload: ReviewRequestPayload): Promise<RequestDto> {
		const { data } = await apiClient.patch<RequestDto>(`/reviews/${id}`, payload);
		return data;
	}

	static async timeline(id: string): Promise<RequestDetail> {
		const { data } = await apiClient.get<RequestDetail>(`/reviews/${id}/timeline`);
		return data;
	}
}
