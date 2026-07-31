"use client";

import type { RequestDetail } from "@saude-bliss/contracts";
import { REQUEST_EVENT_TYPE_LABELS } from "@saude-bliss/contracts";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { RequestIdBadge } from "~/components/shared/RequestIdBadge";
import { PriorityBadge, StatusBadge } from "~/components/ui/Badge";
import { formatDateTime } from "~/lib/utils";
import { ApiError } from "~/services/instances";
import { RequestsService } from "~/services/requests.service";

/** No Next 16 `params` é uma Promise e precisa ser desembrulhada com `use`. */
export default function SolicitacaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = use(params);
	const [detail, setDetail] = useState<RequestDetail | null>(null);
	const [error, setError] = useState<{ message: string; notFound: boolean; requestId?: string } | null>(null);
	const [refreshingTimeline, setRefreshingTimeline] = useState(false);
	const [timelineError, setTimelineError] = useState<string | null>(null);

	useEffect(() => {
		RequestsService.getById(id)
			.then(setDetail)
			.catch((caught: unknown) => {
				const apiError = caught instanceof ApiError ? caught : null;
				setError({
					message: apiError?.message ?? "Falha ao carregar a solicitação",
					notFound: apiError?.code === "REQUEST_NOT_FOUND",
					requestId: apiError?.requestId,
				});
			});
	}, [id]);

	/**
	 * Recarrega apenas a trilha, por `GET /reviews/{id}/timeline`.
	 *
	 * Outro microserviço de propósito: a trilha pertence ao domínio de conferência,
	 * e é `bliss-reviews` quem a escreve. Depois que alguém confere a solicitação
	 * noutra aba, é esta chamada que traz o evento novo sem recarregar a página.
	 */
	async function refreshTimeline() {
		setRefreshingTimeline(true);
		setTimelineError(null);

		try {
			setDetail(await RequestsService.timeline(id));
		} catch (caught) {
			setTimelineError(caught instanceof ApiError ? caught.message : "Falha ao recarregar a trilha");
		} finally {
			setRefreshingTimeline(false);
		}
	}

	if (error) {
		return (
			<div className="space-y-4" data-testid={error.notFound ? "not-found-state" : "error-state"}>
				<p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
					{error.message}
				</p>
				<RequestIdBadge requestId={error.requestId} />
				<Link href="/solicitacoes" className="text-sm text-slate-600 hover:underline">
					← Voltar para a listagem
				</Link>
			</div>
		);
	}

	if (!detail) return <p className="text-sm text-slate-500">Carregando…</p>;

	return (
		<div className="space-y-6" data-testid="request-detail" data-request-id={detail.id}>
			<Link href="/solicitacoes" className="text-sm text-slate-600 hover:underline">
				← Voltar para a listagem
			</Link>

			<div className="rounded-lg border border-slate-200 bg-white p-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<h1 className="text-xl font-semibold" data-testid="detail-title">
						{detail.title}
					</h1>
					<div className="flex gap-2">
						<PriorityBadge priority={detail.priority} />
						<StatusBadge status={detail.status} />
					</div>
				</div>

				<p className="mt-4 whitespace-pre-wrap text-sm text-slate-700" data-testid="detail-description">
					{detail.description}
				</p>

				{/*
				 * `min-w-0` e `break-words` nas células: item de grid nasce com
				 * `min-width: auto`, então um e-mail longo ou um UUID — que não têm
				 * onde quebrar — estouram a coluna e escrevem por cima da vizinha em
				 * tela estreita. É exatamente o conteúdo que estas células recebem.
				 */}
				<dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
					<div className="min-w-0">
						<dt className="text-xs text-slate-500">Solicitante</dt>
						<dd className="break-words" data-testid="detail-createdBy">
							{detail.createdBy}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-xs text-slate-500">Criada em</dt>
						<dd>{formatDateTime(detail.createdAt)}</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-xs text-slate-500">Conferida por</dt>
						<dd className="break-words" data-testid="detail-reviewedBy">
							{detail.reviewedBy ?? "—"}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-xs text-slate-500">Trace da criação</dt>
						<dd className="break-words font-mono text-xs" data-testid="detail-createdTraceId">
							{detail.createdTraceId ?? "—"}
						</dd>
					</div>
				</dl>
			</div>

			<section className="rounded-lg border border-slate-200 bg-white p-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Trilha de auditoria</h2>
					<button
						onClick={() => void refreshTimeline()}
						disabled={refreshingTimeline}
						className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
						data-testid="detail-refresh-timeline"
						title="GET /reviews/{id}/timeline"
					>
						{refreshingTimeline ? "Recarregando…" : "Recarregar trilha"}
					</button>
				</div>

				{timelineError && (
					<p
						className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700"
						role="alert"
						data-testid="timeline-error"
					>
						{timelineError}
					</p>
				)}

				{/*
				 * A trilha é lida por gente conferindo o que aconteceu, então cada
				 * evento responde às quatro perguntas na ordem em que se pergunta:
				 * o quê, para qual situação, por quem e quando. O `traceId` fica por
				 * último e apagado — serve para achar a requisição no CloudWatch,
				 * não para ser lido em sequência.
				 */}
				<ol className="mt-4 space-y-2" data-testid="detail-timeline" data-count={detail.events.length}>
					{detail.events.map((event) => (
						<li
							key={event.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-slate-50 px-3 py-2.5 text-sm"
							data-testid="timeline-event"
							data-event-type={event.type}
						>
							<span className="font-medium text-slate-800">{REQUEST_EVENT_TYPE_LABELS[event.type]}</span>

							<span className="flex items-center gap-1.5">
								{/* A transição só aparece quando houve uma: em `created` o "de"
								    é vazio, e uma seta partindo do nada confunde. */}
								{event.fromStatus && (
									<>
										<StatusBadge status={event.fromStatus} />
										<span aria-hidden className="text-slate-400">
											→
										</span>
									</>
								)}
								<StatusBadge status={event.toStatus} />
							</span>

							<span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
								{event.actor && <span>por {event.actor}</span>}
								<span>{formatDateTime(event.createdAt)}</span>
								{event.traceId && (
									<span className="font-mono text-slate-400" title="Identificador desta requisição nos logs">
										{event.traceId}
									</span>
								)}
							</span>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}
