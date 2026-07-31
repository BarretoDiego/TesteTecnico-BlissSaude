"use client";

/**
 * @module web/components/pages/RequestsTable
 *
 * Tabela de solicitações.
 *
 * Todo elemento que a automação precisa alcançar tem `data-testid` estável, e os
 * valores também aparecem em `data-*`. É o que permite ao Playwright comparar o
 * que a tela mostra com o que a API devolve sem depender de texto traduzido nem
 * de posição de coluna.
 */

import type { Request as RequestDto } from "@saude-bliss/contracts";
import Link from "next/link";
import { PriorityBadge, StatusBadge } from "~/components/ui/Badge";
import { formatDateTime } from "~/lib/utils";

interface Props {
	items: RequestDto[];
	/** Ação por linha — usada na fila de conferência. */
	renderAction?: (request: RequestDto) => React.ReactNode;
}

export function RequestsTable({ items, renderAction }: Props) {
	if (items.length === 0) {
		return (
			<p
				className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500"
				data-testid="empty-state"
			>
				Nenhuma solicitação encontrada com os filtros atuais.
			</p>
		);
	}

	return (
		<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
			<table className="w-full text-sm" data-testid="requests-table">
				<thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th className="px-4 py-3">Título</th>
						<th className="px-4 py-3">Solicitante</th>
						<th className="px-4 py-3">Prioridade</th>
						<th className="px-4 py-3">Status</th>
						<th className="px-4 py-3">Criada em</th>
						{renderAction && <th className="px-4 py-3" />}
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-100">
					{items.map((request) => (
						<tr key={request.id} data-testid={`request-row-${request.id}`} data-request-id={request.id}>
							<td className="px-4 py-3">
								<Link
									href={`/solicitacoes/${request.id}`}
									className="font-medium text-slate-900 hover:underline"
									data-testid="request-cell-title"
								>
									{request.title}
								</Link>
							</td>
							<td className="px-4 py-3 text-slate-600" data-testid="request-cell-createdBy">
								{request.createdBy}
							</td>
							<td className="px-4 py-3">
								<PriorityBadge priority={request.priority} />
							</td>
							<td className="px-4 py-3">
								<StatusBadge status={request.status} />
							</td>
							<td className="px-4 py-3 text-slate-500" data-testid="request-cell-createdAt">
								{formatDateTime(request.createdAt)}
							</td>
							{renderAction && <td className="px-4 py-3 text-right">{renderAction(request)}</td>}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
