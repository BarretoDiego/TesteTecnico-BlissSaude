"use client";

/**
 * @module web/providers/SessionProvider
 *
 * Sessão do usuário.
 *
 * O access token vive **em memória**, não em `localStorage`: é o que reduz a
 * janela de um XSS, já que script injetado não consegue lê-lo de um closure. O
 * refresh token fica em `localStorage` por necessidade — sem ele a sessão morre
 * a cada recarga — mas é revogável no servidor, então o estrago de um vazamento
 * é contornável.
 */

import type { AuthenticatedUser } from "@saude-bliss/contracts";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthService } from "~/services/auth.service";
import { setAccessToken } from "~/services/instances";

const REFRESH_TOKEN_KEY = "saude-bliss.refresh-token";

interface SessionContextValue {
	user: AuthenticatedUser | null;
	/** `true` enquanto a sessão é restaurada — evita piscar a tela de login. */
	loading: boolean;
	login: (email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<AuthenticatedUser | null>(null);
	const [loading, setLoading] = useState(true);
	const router = useRouter();

	/**
	 * Restaura a sessão na carga.
	 *
	 * Troca o refresh token guardado por um access token novo. Falha aqui é
	 * esperada — token expirado, revogado, ausente — e resulta em sessão vazia,
	 * não em erro na tela.
	 */
	useEffect(() => {
		const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
		if (!stored) {
			setLoading(false);
			return;
		}

		AuthService.refresh(stored)
			.then((session) => {
				localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
				setUser(session.user);
			})
			.catch(() => {
				localStorage.removeItem(REFRESH_TOKEN_KEY);
				setAccessToken(undefined);
			})
			.finally(() => setLoading(false));
	}, []);

	const login = useCallback(async (email: string, password: string) => {
		const session = await AuthService.login({ email, password });
		localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
		setUser(session.user);
	}, []);

	const logout = useCallback(async () => {
		const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
		if (stored) await AuthService.logout(stored);

		localStorage.removeItem(REFRESH_TOKEN_KEY);
		setUser(null);
		router.push("/login");
	}, [router]);

	const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
	const context = useContext(SessionContext);
	if (!context) throw new Error("useSession precisa estar dentro de SessionProvider");
	return context;
}
