/**
 * @module web/services/instances
 *
 * Cliente HTTP da API.
 *
 * Centraliza o que toda chamada precisa fazer igual: anexar o token, gerar e
 * propagar o `x-request-id`, medir a duração e desembrulhar o envelope. Nenhum
 * componente chama `axios` ou `fetch` direto — é a regra que mantém a
 * rastreabilidade e o tratamento de erro fora do alcance do esquecimento.
 */

import { REQUEST_ID_HEADER, type Envelope } from "@saude-bliss/contracts";
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

/** Erro tipado a partir do envelope de erro da API. */
export class ApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
		readonly requestId?: string,
		readonly details?: unknown
	) {
		super(message);
		this.name = "ApiError";
	}

	/** `true` quando a sessão caiu e o usuário precisa autenticar de novo. */
	get isUnauthenticated(): boolean {
		return this.status === 401;
	}
}

declare module "axios" {
	export interface InternalAxiosRequestConfig {
		metadata?: { requestId: string; startedAt: number };
	}
}

/**
 * Origem da API.
 *
 * Duas variáveis de propósito: no servidor a chamada sai do container, no
 * browser sai da máquina do usuário. São iguais em desenvolvimento e diferentes
 * em qualquer deploy conteinerizado — manter as duas documenta a distinção antes
 * que ela morda.
 */
function resolveBaseUrl(): string {
	if (typeof window === "undefined") {
		return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";
	}
	return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";
}

export interface InterceptorConfig {
	client: AxiosInstance;
	clientName: string;
	/** Anexa o `Authorization` quando há sessão. */
	attachAuthToken?: boolean;
	/** Limpa a sessão local em 401 — evita o usuário ficar num limbo autenticado. */
	clearAuthOnUnauthorized?: boolean;
}

/** Lido pelo interceptor. Definido pelo provedor de sessão no browser. */
let accessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
	accessToken = token;
}

export function getAccessToken(): string | undefined {
	return accessToken;
}

function applyInterceptors(config: InterceptorConfig): AxiosInstance {
	const { client, clientName } = config;

	client.interceptors.request.use((request: InternalAxiosRequestConfig) => {
		// Id gerado no cliente e enviado no header: é o que faz o trace começar no
		// browser e sobreviver até as linhas de log no CloudWatch.
		const requestId = crypto.randomUUID();
		request.headers.set(REQUEST_ID_HEADER, requestId);
		request.metadata = { requestId, startedAt: Date.now() };

		if (config.attachAuthToken !== false && accessToken) {
			request.headers.set("Authorization", `Bearer ${accessToken}`);
		}
		return request;
	});

	client.interceptors.response.use(
		(response) => {
			const envelope = response.data as Envelope<unknown>;
			// Desembrulha aqui, uma vez: sem isto todo chamador escreveria
			// `response.data.data` e o envelope vazaria para dentro dos componentes.
			if (envelope && typeof envelope === "object" && "success" in envelope && envelope.success) {
				response.data = envelope.data;
			}
			return response;
		},
		(error: AxiosError) => {
			const envelope = error.response?.data as Envelope<unknown> | undefined;
			const status = error.response?.status ?? 0;

			if (envelope && "error" in envelope) {
				if (status === 401 && config.clearAuthOnUnauthorized !== false) {
					setAccessToken(undefined);
				}
				return Promise.reject(
					new ApiError(envelope.error.code, envelope.error.message, status, envelope.requestId, envelope.error.details)
				);
			}

			// Sem envelope: a falha aconteceu antes da aplicação — rede, timeout,
			// gateway. Mensagem genérica, mas com o nome do cliente para localizar.
			return Promise.reject(
				new ApiError("NETWORK_ERROR", `Falha de comunicação com ${clientName}`, status, undefined, error.message)
			);
		}
	);

	return client;
}

export const apiClient = applyInterceptors({
	client: axios.create({ baseURL: resolveBaseUrl(), timeout: 30_000 }),
	clientName: "API Saúde Bliss",
	attachAuthToken: true,
	clearAuthOnUnauthorized: true,
});
