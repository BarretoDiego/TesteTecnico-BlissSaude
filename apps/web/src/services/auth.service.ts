/**
 * @module web/services/auth.service
 */

import type { AuthSession, AuthenticatedUser, LoginPayload } from "@saude-bliss/contracts";
import { apiClient, setAccessToken } from "./instances";

/** Chamadas ao microserviço `bliss-auth`. */
export class AuthService {
	static async login(payload: LoginPayload): Promise<AuthSession> {
		const { data } = await apiClient.post<AuthSession>("/auth/login", payload);
		setAccessToken(data.accessToken);
		return data;
	}

	static async refresh(refreshToken: string): Promise<AuthSession> {
		const { data } = await apiClient.post<AuthSession>("/auth/refresh", { refreshToken });
		setAccessToken(data.accessToken);
		return data;
	}

	static async logout(refreshToken: string): Promise<void> {
		// Não propaga falha: se o servidor não conseguiu revogar, a sessão local
		// cai de qualquer forma — deixar o usuário preso na tela seria pior.
		await apiClient.post("/auth/logout", { refreshToken }).catch(() => undefined);
		setAccessToken(undefined);
	}

	static async me(): Promise<AuthenticatedUser> {
		const { data } = await apiClient.get<AuthenticatedUser>("/auth/me");
		return data;
	}
}
