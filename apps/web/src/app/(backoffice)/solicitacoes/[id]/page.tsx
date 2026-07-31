"use client";

import type { RequestDetail } from "@saude-bliss/contracts";
import { REQUEST_STATUS_LABELS } from "@saude-bliss/contracts";
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

				<dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
					<div>
						<dt className="text-xs text-slate-500">Solicitante</dt>
						<dd data-testid="detail-createdBy">{detail.createdBy}</dd>
					</div>
					<div>
						<dt className="text-xs text-slate-500">Criada em</dt>
						<dd>{formatDateTime(detail.createdAt)}</dd>
					</div>
					<div>
						<dt className="text-xs text-slate-500">Conferida por</dt>
						<dd data-testid="detail-reviewedBy">{detail.reviewedBy ?? "—"}</dd>
					</div>
					<div>
						<dt className="text-xs text-slate-500">Trace da criação</dt>
						<dd className="font-mono text-xs" data-testid="detail-createdTraceId">
							{detail.createdTraceId ?? "—"}
						</dd>
					</div>
				</dl>
			</div>

			<section className="rounded-lg border border-slate-200 bg-white p-6">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Trilha de auditoria</h2>
				<ol className="mt-4 space-y-3" data-testid="detail-timeline">
					{detail.events.map((event) => (
						<li key={event.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid="timeline-event">
							<span className="font-medium">{event.type}</span>
							<span className="text-slate-500">
								{event.fromStatus ? `${REQUEST_STATUS_LABELS[event.fromStatus]} → ` : ""}
								{REQUEST_STATUS_LABELS[event.toStatus]}
							</span>
							<span className="text-slate-400">{event.actor}</span>
							<span className="ml-auto font-mono text-xs text-slate-400">{event.traceId}</span>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}
