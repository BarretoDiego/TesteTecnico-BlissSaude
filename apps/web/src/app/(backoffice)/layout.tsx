"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ProfileDialog } from "~/components/shared/ProfileDialog";
import { useSession } from "~/providers/SessionProvider";

const NAV = [
	{ href: "/solicitacoes", label: "Solicitações" },
	{ href: "/conferencia", label: "Conferência" },
	{ href: "/status", label: "Status" },
];

/**
 * Casca autenticada.
 *
 * O guarda é de conveniência — quem protege de fato é o authorizer no API
 * Gateway. Sem sessão a tela redireciona em vez de mostrar erro de rede a cada
 * chamada, mas nenhum dado chega ao browser sem token válido de qualquer forma.
 */
export default function BackofficeLayout({ children }: { children: ReactNode }) {
	const { user, loading, logout } = useSession();
	const router = useRouter();
	const pathname = usePathname();
	const [profileOpen, setProfileOpen] = useState(false);

	useEffect(() => {
		if (!loading && !user) router.replace("/login");
	}, [loading, user, router]);

	if (loading) {
		return <div className="p-8 text-sm text-slate-500">Carregando…</div>;
	}
	if (!user) return null;

	return (
		<div className="min-h-screen">
			{/*
			 * O cabeçalho é a peça que primeiro estoura em tela estreita: são três
			 * itens de menu, o nome de quem está logado e o sair, todos numa linha
			 * só. Em 393px isso somava 517px de conteúdo — a página inteira ganhava
			 * rolagem horizontal e o menu passava por cima do botão de perfil, que
			 * ficava inalcançável ao toque.
			 *
			 * A correção é por prioridade, não por quebra de linha: o que identifica
			 * o produto (a marca) e o que repete o que o avatar já diz (o nome) saem
			 * primeiro; menu e ações continuam sempre visíveis, e o menu rola sozinho
			 * se algum dia crescer, em vez de empurrar o resto para fora da tela.
			 */}
			<header className="border-b border-slate-200 bg-white">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-8 sm:px-6 sm:py-4">
					<div className="flex min-w-0 items-center gap-4 sm:gap-8">
						<span className="hidden shrink-0 font-semibold sm:inline">Saúde Bliss</span>
						<nav className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1">
							{NAV.map((item) => (
								<Link
									key={item.href}
									href={item.href}
									className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${
										pathname.startsWith(item.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
									}`}
									data-testid={`nav-${item.href.slice(1)}`}
								>
									{item.label}
								</Link>
							))}
						</nav>
					</div>

					<div className="flex shrink-0 items-center gap-2 sm:gap-4">
						<button
							onClick={() => setProfileOpen(true)}
							className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
							data-testid="current-user"
							aria-haspopup="dialog"
							// O nome some em tela estreita, então ele precisa continuar
							// existindo para quem usa leitor de tela — o avatar é decorativo.
							aria-label={`Perfil de ${user.name}`}
						>
							<span
								className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white"
								aria-hidden
							>
								{user.name.slice(0, 2).toUpperCase()}
							</span>
							<span className="hidden sm:inline">{user.name}</span>
						</button>
						<button
							onClick={() => void logout()}
							className="text-sm text-slate-500 hover:text-slate-900"
							data-testid="logout"
						>
							Sair
						</button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

			<ProfileDialog
				open={profileOpen}
				fallback={user}
				onClose={() => setProfileOpen(false)}
				onLogout={() => {
					setProfileOpen(false);
					void logout();
				}}
			/>
		</div>
	);
}
