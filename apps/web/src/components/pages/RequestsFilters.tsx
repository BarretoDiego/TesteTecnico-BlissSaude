"use client";

/**
 * @module web/components/pages/RequestsFilters
 *
 * Filtros da listagem.
 *
 * O estado vive **na URL**, não em `useState`. Três consequências: o filtro é
 * compartilhável e sobrevive à recarga, o botão voltar do navegador funciona, e
 * a automação navega direto para um estado filtrado em vez de simular cliques
 * até chegar nele.
 */

import {
	REQUEST_PRIORITIES,
	REQUEST_PRIORITY_LABELS,
	REQUEST_STATUSES,
	REQUEST_STATUS_LABELS,
} from "@saude-bliss/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function RequestsFilters() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const update = useCallback(
		(key: string, value: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value) params.set(key, value);
			else params.delete(key);
			// Filtrar reinicia a paginação: manter `page=3` ao trocar de filtro
			// costuma cair numa página vazia.
			params.delete("page");
			router.replace(`${pathname}?${params.toString()}`);
		},
		[router, pathname, searchParams]
	);

	return (
		<div className="flex flex-wrap items-end gap-3" data-testid="requests-filters">
			<label className="space-y-1.5">
				<span className="block text-xs font-medium text-slate-600">Status</span>
				<select
					value={searchParams.get("status") ?? ""}
					onChange={(event) => update("status", event.target.value)}
					className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
					data-testid="filter-status"
				>
					<option value="">Todos</option>
					{REQUEST_STATUSES.map((status) => (
						<option key={status} value={status}>
							{REQUEST_STATUS_LABELS[status]}
						</option>
					))}
				</select>
			</label>

			<label className="space-y-1.5">
				<span className="block text-xs font-medium text-slate-600">Prioridade</span>
				<select
					value={searchParams.get("priority") ?? ""}
					onChange={(event) => update("priority", event.target.value)}
					className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
					data-testid="filter-priority"
				>
					<option value="">Todas</option>
					{REQUEST_PRIORITIES.map((priority) => (
						<option key={priority} value={priority}>
							{REQUEST_PRIORITY_LABELS[priority]}
						</option>
					))}
				</select>
			</label>

			<label className="space-y-1.5">
				<span className="block text-xs font-medium text-slate-600">Solicitante</span>
				<input
					type="text"
					defaultValue={searchParams.get("createdBy") ?? ""}
					// `onBlur` e não `onChange`: filtrar a cada tecla dispararia uma
					// requisição por caractere digitado.
					onBlur={(event) => update("createdBy", event.target.value.trim())}
					placeholder="e-mail do solicitante"
					className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
					data-testid="filter-createdBy"
				/>
			</label>

			<button
				onClick={() => router.replace(pathname)}
				className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
				data-testid="filter-clear"
			>
				Limpar
			</button>
		</div>
	);
}
