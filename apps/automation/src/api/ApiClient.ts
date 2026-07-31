/**
 * @module automation/api/ApiClient
 *
 * Cliente da API — o **oráculo** da conferência.
 *
 * A suíte compara o que a tela renderiza com o que a API devolve. É essa
 * comparação que faz o teste ser uma conferência de verdade, e não um roteiro de
 * cliques que passa mesmo com a tela mostrando dado errado.
 *
 * Também semeia os dados de cada teste: depender do que já estiver no banco
 * torna o resultado função da ordem de execução.
 */

import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import type {
	AuthSession,
	CreateRequestPayload,
	ListRequestsResult,
	RequestDetail,
	Request as RequestDto,
} from "@saude-bliss/contracts";

export class ApiClient {
	private constructor(
		private readonly context: APIRequestContext,
		private readonly accessToken: string,
		readonly session: AuthSession
	) {}

	/**
	 * Autentica e devolve um cliente pronto.
	 *
	 * A barra final no `baseURL` e a ausência de barra inicial nos caminhos não
	 * são estilo: o Playwright resolve URL relativa com a semântica de
	 * `new URL(path, baseURL)`, e nela um caminho começando por `/` **descarta** o
	 * prefixo do baseURL. Com `http://localhost:4000/v1` e `"/auth/login"`, o
	 * resultado é `http://localhost:4000/auth/login` — sem o `/v1`, e a API
	 * responde 404 sem nenhuma pista do motivo.
	 */
	static async create(baseURL: string, email: string, password: string): Promise<ApiClient> {
		const context = await playwrightRequest.newContext({
			baseURL: baseURL.endsWith("/") ? baseURL : `${baseURL}/`,
		});

		const response = await context.post("auth/login", { data: { email, password } });
		if (!response.ok()) {
			throw new Error(`falha ao autenticar na API (${response.status()}): ${await response.text()}`);
		}

		const body = (await response.json()) as { data: AuthSession };
		return new ApiClient(context, body.data.accessToken, body.data);
	}

	private get headers(): Record<string, string> {
		return { Authorization: `Bearer ${this.accessToken}` };
	}

	/**
	 * Requisição com id de correlação explícito.
	 *
	 * Permite ao teste afirmar que o id que ele enviou é o que a tela exibe — a
	 * verificação de rastreabilidade ponta a ponta.
	 */
	async createRequest(payload: CreateRequestPayload, requestId?: string): Promise<RequestDto> {
		const response = await this.context.post("requests", {
			data: payload,
			headers: { ...this.headers, ...(requestId ? { "x-request-id": requestId } : {}) },
		});

		if (!response.ok()) {
			throw new Error(`falha ao criar solicitação (${response.status()}): ${await response.text()}`);
		}
		const body = (await response.json()) as { data: RequestDto };
		return body.data;
	}

	async listRequests(query: Record<string, string | number> = {}): Promise<ListRequestsResult> {
		const params = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)]));
		const response = await this.context.get("requests", { headers: this.headers, params });
		const body = (await response.json()) as { data: ListRequestsResult };
		return body.data;
	}

	async getRequest(id: string): Promise<RequestDetail> {
		const response = await this.context.get(`requests/${id}`, { headers: this.headers });
		const body = (await response.json()) as { data: RequestDetail };
		return body.data;
	}

	async getTimeline(id: string): Promise<RequestDetail> {
		const response = await this.context.get(`reviews/${id}/timeline`, { headers: this.headers });
		const body = (await response.json()) as { data: RequestDetail };
		return body.data;
	}

	async dispose(): Promise<void> {
		await this.context.dispose();
	}
}
