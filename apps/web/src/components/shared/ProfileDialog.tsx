"use client";

/**
 * @module web/components/shared/ProfileDialog
 *
 * Detalhes do usuário da sessão.
 *
 * Os dados vêm de `GET /auth/me` a cada abertura, e não do estado da sessão que
 * já está em memória. A diferença importa: a sessão guarda o que veio no login,
 * que pode estar velho — um perfil concedido ou revogado depois não apareceria.
 * Consultar na abertura mostra o que o servidor reconhece **agora**, que é a
 * pergunta que alguém faz ao abrir o próprio perfil.
 */

import type { AuthenticatedUser } from "@saude-bliss/contracts";
import { useEffect, useState } from "react";
import { Dialog } from "~/components/ui/Dialog";
import { AuthService } from "~/services/auth.service";
import { ApiError } from "~/services/instances";

interface Props {
	open: boolean;
	/** Identidade do login — exibida enquanto a consulta não volta. */
	fallback: AuthenticatedUser;
	onClose: () => void;
	onLogout: () => void;
}

/** Rótulos dos perfis. O valor cru (`requester`) não diz nada a quem lê. */
const ROLE_LABELS: Record<string, string> = {
	admin: "Administração",
	reviewer: "Conferência",
	requester: "Abertura de solicitações",
};

export function ProfileDialog({ open, fallback, onClose, onLogout }: Props) {
	const [user, setUser] = useState<AuthenticatedUser>(fallback);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;

		setLoading(true);
		setError(null);

		AuthService.me()
			.then(setUser)
			// Falhar aqui não esvazia a tela: o modal continua mostrando a identidade
			// do login, com o aviso de que a consulta não voltou.
			.catch((caught: unknown) =>
				setError(caught instanceof ApiError ? caught.message : "Não foi possível atualizar os dados do perfil")
			)
			.finally(() => setLoading(false));
	}, [open]);

	return (
		<Dialog
			open={open}
			title="Seu perfil"
			onClose={onClose}
			testId="profile-dialog"
			footer={
				<>
					<button
						onClick={onClose}
						className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
						data-testid="profile-dialog-close"
					>
						Fechar
					</button>
					<button
						onClick={onLogout}
						className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
						data-testid="profile-dialog-logout"
					>
						Sair da conta
					</button>
				</>
			}
		>
			<div className="space-y-4" data-loading={String(loading)}>
				<div className="flex items-center gap-3">
					<span
						className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-medium text-white"
						aria-hidden
					>
						{user.name.slice(0, 2).toUpperCase()}
					</span>
					<div className="min-w-0">
						<p className="font-medium text-slate-900" data-testid="profile-name">
							{user.name}
						</p>
						<p className="break-words text-sm text-slate-500" data-testid="profile-email">
							{user.email}
						</p>
					</div>
				</div>

				<dl className="space-y-3 border-t border-slate-100 pt-4 text-sm">
					<div>
						<dt className="text-xs text-slate-500">Perfis de acesso</dt>
						<dd className="mt-1 flex flex-wrap gap-1.5" data-testid="profile-roles" data-roles={user.roles.join(",")}>
							{user.roles.map((role) => (
								<span
									key={role}
									className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-600/20"
								>
									{ROLE_LABELS[role] ?? role}
								</span>
							))}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-xs text-slate-500">Identificador</dt>
						<dd className="mt-1 break-words font-mono text-xs text-slate-600" data-testid="profile-id">
							{user.id}
						</dd>
					</div>
				</dl>

				{error && (
					<p
						className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"
						role="status"
						data-testid="profile-error"
					>
						{error} — exibindo os dados do login.
					</p>
				)}
			</div>
		</Dialog>
	);
}
