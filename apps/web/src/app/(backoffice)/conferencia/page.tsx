"use client";

import type { Request as RequestDto } from "@saude-bliss/contracts";
import { PENDING_REVIEW_STATUSES } from "@saude-bliss/contracts";
import { useCallback, useEffect, useState } from "react";
import { RequestsTable } from "~/components/pages/RequestsTable";
import { RequestIdBadge } from "~/components/shared/RequestIdBadge";
import { useSession } from "~/providers/SessionProvider";
import { ApiError } from "~/services/instances";
import { RequestsService } from "~/services/requests.service";

/**
 * Fila de conferência.
 *
 * A tela que a automação substitui: hoje alguém abre a lista de abertas, confere
 * uma a uma contra o registro e marca como revisada. É esse fluxo que a suíte
 * Playwright executa.
 *
 * A fila carrega os status pendentes em paralelo e concatena: a API filtra por
 * um status só, e pedir os dois em sequência dobraria a latência da tela sem
 * necessidade.
 */
export default function ConferenciaPage() {
	const { user } = useSession();
	const [queue, setQueue] = useState<RequestDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [requestId, setRequestId] = useState<string>();
	const [reviewing, setReviewing] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const pages = await Promise.all(
				PENDING_REVIEW_STATUSES.map((status) => RequestsService.list({ status, pageSize: 100 }))
			);
			const items = pages.flatMap((page) => page.items);
			items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
			setQueue(items);
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : "Falha ao carregar a fila");
			if (caught instanceof ApiError) setRequestId(caught.requestId);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const review = useCallback(
		async (id: string, status: "reviewed" | "rejected") => {
			if (!user) return;
			setReviewing(id);
			setError(null);

			try {
				await RequestsService.review(id, { reviewedBy: user.email, status });
				// Remove da fila localmente em vez de recarregar tudo: a resposta já
				// confirmou a mudança, e recarregar piscaria a tela inteira.
				setQueue((current) => current.filter((request) => request.id !== id));
			} catch (caught) {
				// 409 aqui significa que outra pessoa conferiu primeiro — a mensagem da
				// API já explica isso, e recarregar a fila mostra o estado real.
				setError(caught instanceof ApiError ? caught.message : "Falha ao registrar a conferência");
				if (caught instanceof ApiError) setRequestId(caught.requestId);
				await load();
			} finally {
				setReviewing(null);
			}
		},
		[user, load]
	);

	return (
		<div className="space-y-6" data-testid="conferencia" data-loading={String(loading)}>
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Conferência</h1>
					<p className="mt-1 text-sm text-slate-500" data-testid="conferencia-pending-count">
						{loading ? "…" : `${queue.length} solicitação(ões) aguardando conferência`}
					</p>
				</div>
				<RequestIdBadge requestId={requestId} />
			</div>

			{error && (
				<p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert" data-testid="error-state">
					{error}
				</p>
			)}

			{loading ? (
				<p className="text-sm text-slate-500" data-testid="loading-state">
					Carregando fila…
				</p>
			) : (
				<div data-testid="conferencia-queue">
					<RequestsTable
						items={queue}
						renderAction={(request) => (
							<div className="flex justify-end gap-2">
								<button
									onClick={() => void review(request.id, "reviewed")}
									disabled={reviewing === request.id}
									className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
									data-testid={`conferencia-mark-reviewed-${request.id}`}
								>
									{reviewing === request.id ? "…" : "Revisar"}
								</button>
								<button
									onClick={() => void review(request.id, "rejected")}
									disabled={reviewing === request.id}
									className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
									data-testid={`conferencia-mark-rejected-${request.id}`}
								>
									Rejeitar
								</button>
							</div>
						)}
					/>
				</div>
			)}
		</div>
	);
}
