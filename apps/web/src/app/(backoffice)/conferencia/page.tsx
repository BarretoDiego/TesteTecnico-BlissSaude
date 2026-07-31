"use client";

import type { ListRequestsResult, Request as RequestDto } from "@saude-bliss/contracts";
import { PENDING_REVIEW_STATUSES } from "@saude-bliss/contracts";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { RequestsPagination } from "~/components/pages/RequestsPagination";
import { RequestsTable } from "~/components/pages/RequestsTable";
import { RequestIdBadge } from "~/components/shared/RequestIdBadge";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useSession } from "~/providers/SessionProvider";
import { ApiError } from "~/services/instances";
import { RequestsService } from "~/services/requests.service";

/** Os dois status pendentes numa consulta só — o filtro aceita lista. */
const PENDING_FILTER = PENDING_REVIEW_STATUSES.join(",");

/**
 * Fila de conferência.
 *
 * A tela que a automação substitui: hoje alguém abre a lista de abertas, confere
 * uma a uma contra o registro e marca como revisada. É esse fluxo que a suíte
 * Playwright executa.
 */
function ConferenciaContent() {
	const { user } = useSession();
	const searchParams = useSearchParams();
	const [result, setResult] = useState<ListRequestsResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [requestId, setRequestId] = useState<string>();
	const [reviewing, setReviewing] = useState<string | null>(null);
	/** Ação escolhida, aguardando confirmação. `null` = nenhum modal aberto. */
	const [pendingAction, setPendingAction] = useState<{
		request: RequestDto;
		status: "reviewed" | "rejected";
	} | null>(null);

	const queue = result?.items ?? [];

	/**
	 * Carrega uma página da fila.
	 *
	 * Antes eram duas listagens concatenadas, uma por status, com `pageSize: 100`.
	 * Aquilo não tinha como paginar honestamente: o total seria a soma de duas
	 * consultas truncadas, e a partir de 100 pendentes de um mesmo status a fila
	 * escondia trabalho sem avisar. Com o filtro aceitando lista, é uma consulta
	 * paginada só e o total vem do banco.
	 */
	const load = useCallback(
		async ({ silent = false }: { silent?: boolean } = {}) => {
			// Recarga silenciosa não acende o "Carregando fila…": depois de uma
			// conferência a tela já mostra o resultado certo, e trocar a tabela por
			// texto de carregamento a cada linha conferida pisca a tela inteira.
			if (!silent) setLoading(true);
			setError(null);

			try {
				setResult(
					await RequestsService.list({
						status: PENDING_FILTER,
						// `Number(null)` é 0 e `Number("abc")` é NaN — ambos caem no
						// `|| undefined` e deixam o default do schema valer, em vez de
						// mandar lixo para a API por causa de uma URL editada à mão.
						page: Number(searchParams.get("page")) || undefined,
						pageSize: Number(searchParams.get("pageSize")) || undefined,
					})
				);
			} catch (caught) {
				setError(caught instanceof ApiError ? caught.message : "Falha ao carregar a fila");
				if (caught instanceof ApiError) setRequestId(caught.requestId);
			} finally {
				if (!silent) setLoading(false);
			}
		},
		[searchParams]
	);

	useEffect(() => {
		void load();
	}, [load]);

	const confirm = useCallback(async () => {
		if (!user || !pendingAction) return;

		const { request, status } = pendingAction;
		setReviewing(request.id);
		setError(null);

		try {
			await RequestsService.review(request.id, { reviewedBy: user.email, status });
			setPendingAction(null);

			// Some da tela na hora: a resposta já confirmou, e esperar a recarga
			// deixaria a linha conferida visível por mais um instante.
			setResult((current) =>
				current ? { ...current, items: current.items.filter((item) => item.id !== request.id) } : current
			);

			// E reconcilia com o servidor em seguida, sem piscar. Só a remoção local
			// deixaria o resumo mentindo — "1–10 de 65" com nove linhas na tela — e a
			// página encolhendo a cada conferência em vez de puxar a próxima pendente.
			await load({ silent: true });
		} catch (caught) {
			// 409 aqui significa que outra pessoa conferiu primeiro — a mensagem da
			// API já explica isso, e recarregar a fila mostra o estado real.
			setError(caught instanceof ApiError ? caught.message : "Falha ao registrar a conferência");
			if (caught instanceof ApiError) setRequestId(caught.requestId);
			setPendingAction(null);
			await load();
		} finally {
			setReviewing(null);
		}
	}, [user, pendingAction, load]);

	const query = searchParams.toString();

	return (
		<div
			className="space-y-6"
			data-testid="conferencia"
			data-loading={String(loading)}
			data-query={loading ? "" : query}
		>
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Conferência</h1>
					{/* A contagem vem da paginação da API, não do tamanho da página:
					    `queue.length` diria "20 aguardando" numa fila de 200. */}
					<p className="mt-1 text-sm text-slate-500" data-testid="conferencia-pending-count">
						{loading ? "…" : `${result?.pagination.total ?? 0} solicitação(ões) aguardando conferência`}
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
				<div className="space-y-6" data-testid="conferencia-queue">
					<RequestsTable
						items={queue}
						renderAction={(request) => (
							<div className="flex justify-end gap-2">
								<button
									onClick={() => setPendingAction({ request, status: "reviewed" })}
									disabled={reviewing === request.id}
									className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
									data-testid={`conferencia-mark-reviewed-${request.id}`}
								>
									{reviewing === request.id ? "…" : "Revisar"}
								</button>
								<button
									onClick={() => setPendingAction({ request, status: "rejected" })}
									disabled={reviewing === request.id}
									className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
									data-testid={`conferencia-mark-rejected-${request.id}`}
								>
									Rejeitar
								</button>
							</div>
						)}
					/>

					{result && <RequestsPagination pagination={result.pagination} />}
				</div>
			)}

			{/*
			 * Conferir é irreversível: a solicitação sai da fila e a transição fica
			 * gravada na trilha em nome de quem confirmou. Um clique errado numa
			 * tabela densa não deveria bastar — e o modal nomeia a solicitação, então
			 * confirmar exige ver qual linha foi atingida.
			 */}
			<ConfirmDialog
				open={pendingAction !== null}
				title={pendingAction?.status === "rejected" ? "Rejeitar solicitação?" : "Marcar como revisada?"}
				description={
					pendingAction
						? `“${pendingAction.request.title}”, de ${pendingAction.request.createdBy}. ` +
							(pendingAction.status === "rejected"
								? "A solicitação sai da fila como rejeitada e a decisão fica registrada em seu nome."
								: "A solicitação sai da fila como revisada e a conferência fica registrada em seu nome.")
						: ""
				}
				confirmLabel={pendingAction?.status === "rejected" ? "Rejeitar" : "Marcar como revisada"}
				tone={pendingAction?.status === "rejected" ? "danger" : "default"}
				pending={reviewing !== null}
				onConfirm={() => void confirm()}
				onCancel={() => setPendingAction(null)}
			/>
		</div>
	);
}

export default function ConferenciaPage() {
	// `useSearchParams` exige limite de Suspense no App Router — sem ele o build
	// falha ao tentar pré-renderizar a página estaticamente.
	return (
		<Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
			<ConferenciaContent />
		</Suspense>
	);
}
