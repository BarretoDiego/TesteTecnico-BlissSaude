"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "~/providers/SessionProvider";
import { ApiError } from "~/services/instances";

export default function LoginPage() {
	const { user, loading, login } = useSession();
	const router = useRouter();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Sessão já restaurada: não faz sentido mostrar o formulário.
	useEffect(() => {
		if (!loading && user) router.replace("/solicitacoes");
	}, [loading, user, router]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		setSubmitting(true);

		try {
			await login(email, password);
			router.replace("/solicitacoes");
		} catch (caught) {
			// A API responde o mesmo 401 para e-mail inexistente e senha errada, de
			// propósito. A tela repete a mensagem dela em vez de tentar adivinhar.
			setError(caught instanceof ApiError ? caught.message : "Não foi possível entrar. Tente novamente.");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<form
				onSubmit={handleSubmit}
				className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
				data-testid="login-form"
			>
				<div>
					<h1 className="text-xl font-semibold">Saúde Bliss</h1>
					<p className="mt-1 text-sm text-slate-500">Backoffice de solicitações</p>
				</div>

				<label className="block space-y-1.5">
					<span className="text-sm font-medium">E-mail</span>
					<input
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
						autoComplete="username"
						className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
						data-testid="login-email"
					/>
				</label>

				<label className="block space-y-1.5">
					<span className="text-sm font-medium">Senha</span>
					<input
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
						autoComplete="current-password"
						className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
						data-testid="login-password"
					/>
				</label>

				{error && (
					<p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert" data-testid="login-error">
						{error}
					</p>
				)}

				<button
					type="submit"
					disabled={submitting}
					className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					data-testid="login-submit"
				>
					{submitting ? "Entrando…" : "Entrar"}
				</button>
			</form>
		</main>
	);
}
