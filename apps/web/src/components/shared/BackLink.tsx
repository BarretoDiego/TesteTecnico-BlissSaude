/**
 * @module web/components/shared/BackLink
 *
 * Retorno para a tela anterior.
 *
 * Era um link de texto cru com uma seta digitada (`←`), sem afordância de
 * clique e desalinhado do resto — que usa botões com borda. Aqui vira o mesmo
 * botão secundário das demais ações, com um chevron desenhado em SVG: a seta
 * tipográfica varia de largura e de linha de base entre fontes e sistemas, e é
 * o que fazia o alinhamento parecer torto.
 */

import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
	href: string;
	children?: ReactNode;
}

export function BackLink({ href, children = "Voltar para a listagem" }: Props) {
	return (
		<Link
			href={href}
			className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
			data-testid="back-link"
		>
			<svg
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.75"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="size-3.5 text-slate-400"
				aria-hidden
			>
				<path d="M10 3.5 5.5 8l4.5 4.5" />
			</svg>
			{children}
		</Link>
	);
}
