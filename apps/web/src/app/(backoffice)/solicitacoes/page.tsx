"use client";

import type { ListRequestsResult } from "@saude-bliss/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { RequestsFilters } from "~/components/pages/RequestsFilters";
import { RequestsTable } from "~/components/pages/RequestsTable";
import { RequestIdBadge } from "~/components/shared/RequestIdBadge";
import { ApiError } from "~/services/instances";
import { RequestsService } from "~/services/requests.service";

function SolicitacoesContent() {
	const searchParams = useSearchParams();
	const [result, setResult] = useState<ListRequestsResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [requestId, setRequestId] = useState<string>();
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const query = Object.fromEntries(searchParams.entries());
			const data = await RequestsService.list(query);
			setResult(data);
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : "Falha ao carregar solicitações");
			if (caught instanceof ApiError) setRequestId(caught.requestId);
		} finally {
			setLoading(false);
		}
	}, [searchParams]);

	useEffect(() => {
		void load();
	}, [load]);

	/**
	 * Sinal de prontidão para a automação.
	 *
	 * `data-loading` sozinho não basta: numa navegação por filtro a tabela
	 * anterior continua na tela enquanto a nova consulta corre, e um teste que
	 * lesse ali pegaria o resultado antigo. `data-query` diz **qual** consulta os
	 * dados exibidos representam, então a espera é por conteúdo correto e não só
	 * por ausência de carregamento.
	 */
	const query = searchParams.toString();

	return (
		<div
			className="space-y-6"
			data-testid="requests-list"
			data-loading={String(loading)}
			data-query={loading ? "" : query}
		>
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Solicitações</h1>
					<p className="mt-1 text-sm text-slate-500" data-testid="requests-total">
						{result ? `${result.pagination.total} solicitação(ões)` : "…"}
					</p>
				</div>
				<div className="flex items-center gap-4">
					<RequestIdBadge requestId={requestId} />
					<Link
						href="/solicitacoes/nova"
						className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
						data-testid="nova-solicitacao"
					>
						Nova solicitação
					</Link>
				</div>
			</div>

			<RequestsFilters />

			{error && (
				<p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert" data-testid="error-state">
					{error}
				</p>
			)}

			{loading && !result ? (
				<p className="text-sm text-slate-500" data-testid="loading-state">
					Carregando…
				</p>
			) : (
				<RequestsTable items={result?.items ?? []} />
			)}
		</div>
	);
}

export default function SolicitacoesPage() {
	// `useSearchParams` exige limite de Suspense no App Router — sem ele o build
	// falha ao tentar pré-renderizar a página estaticamente.
	return (
		<Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
			<SolicitacoesContent />
		</Suspense>
	);
}
