"use client";

/**
 * @module web/components/pages/RequestsPagination
 *
 * Navegação de páginas da listagem.
 *
 * O estado vive na URL, igual aos filtros de `RequestsFilters` — pelos mesmos
 * motivos: a página é compartilhável, sobrevive à recarga, o botão voltar do
 * navegador funciona, e a automação salta direto para uma página em vez de
 * clicar até ela.
 */

import type { Pagination as PaginationDto } from "@saude-bliss/contracts";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { replaceSearchParams } from "~/lib/navigation";
import { cn } from "~/lib/utils";

/** Tamanhos oferecidos. O teto de 100 é o mesmo que o schema da API aceita. */
const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Janela de páginas: primeira, última, a atual e uma vizinha de cada lado.
 *
 * Renderizar as 31 páginas de uma listagem grande é uma barra que não cabe na
 * tela e some no meio do ruído. `null` marca onde entra a elipse.
 */
function pageWindow(current: number, total: number): Array<number | null> {
	if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

	const pages = new Set([1, total, current, current - 1, current + 1]);
	const visible = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

	const withGaps: Array<number | null> = [];
	for (const [index, page] of visible.entries()) {
		const previous = visible[index - 1];
		// Salto maior que 1 vira elipse — sem isso "1 4 5 6 31" sugere que 2 e 3
		// não existem, em vez de que foram omitidas.
		if (previous !== undefined && page - previous > 1) withGaps.push(null);
		withGaps.push(page);
	}
	return withGaps;
}

const BUTTON = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50";
const DISABLED = "cursor-not-allowed opacity-40 hover:bg-white";

export function RequestsPagination({ pagination }: { pagination: PaginationDto }) {
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const { page, pageSize, total, totalPages } = pagination;

	const navigate = useCallback(
		(updates: Record<string, string>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(updates)) {
				if (value) params.set(key, value);
				else params.delete(key);
			}
			// History API e não `router.replace` — ver o porquê em `lib/navigation`.
			replaceSearchParams(pathname, params);
		},
		[pathname, searchParams]
	);

	// Trocar o tamanho volta para a primeira página: manter `page=7` ao passar de
	// 10 para 100 por página cairia numa página que deixou de existir.
	const changePageSize = useCallback(
		(size: string) => navigate({ pageSize: size === "20" ? "" : size, page: "" }),
		[navigate]
	);

	const goTo = useCallback((target: number) => navigate({ page: target === 1 ? "" : String(target) }), [navigate]);

	const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const lastItem = Math.min(page * pageSize, total);

	return (
		<div
			className="flex flex-wrap items-center justify-between gap-4"
			data-testid="pagination"
			data-page={page}
			data-page-size={pageSize}
			data-total-pages={totalPages}
			data-total={total}
		>
			<div className="flex items-center gap-3 text-sm text-slate-600">
				<span data-testid="pagination-summary">
					{total === 0 ? "Nenhum resultado" : `${firstItem}–${lastItem} de ${total}`}
				</span>

				<label className="flex items-center gap-2 text-xs text-slate-500">
					por página
					<select
						value={pageSize}
						onChange={(event) => changePageSize(event.target.value)}
						className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
						data-testid="pagination-page-size"
					>
						{PAGE_SIZES.map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</label>
			</div>

			{totalPages > 1 && (
				<nav className="flex items-center gap-1" aria-label="Navegação de páginas">
					<button
						onClick={() => goTo(page - 1)}
						disabled={page <= 1}
						className={cn(BUTTON, page <= 1 && DISABLED)}
						data-testid="pagination-prev"
					>
						Anterior
					</button>

					{pageWindow(page, totalPages).map((target, index) =>
						target === null ? (
							<span key={`gap-${index}`} className="px-1.5 text-sm text-slate-400" aria-hidden>
								…
							</span>
						) : (
							<button
								key={target}
								onClick={() => goTo(target)}
								// `aria-current` e não só a cor: quem usa leitor de tela precisa
								// saber em qual página está sem depender do contraste.
								aria-current={target === page ? "page" : undefined}
								className={cn(
									"min-w-9 rounded-md px-2.5 py-1.5 text-sm",
									target === page
										? "bg-slate-900 font-medium text-white"
										: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
								)}
								data-testid={`pagination-page-${target}`}
							>
								{target}
							</button>
						)
					)}

					<button
						onClick={() => goTo(page + 1)}
						disabled={page >= totalPages}
						className={cn(BUTTON, page >= totalPages && DISABLED)}
						data-testid="pagination-next"
					>
						Próxima
					</button>
				</nav>
			)}
		</div>
	);
}
