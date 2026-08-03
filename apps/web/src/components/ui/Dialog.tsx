"use client";

/**
 * @module web/components/ui/Dialog
 *
 * Casca de modal sobre o `<dialog>` nativo.
 *
 * Nativo em vez de uma `div` com `position: fixed`, não por preferência: o
 * elemento entrega de graça o que uma div exige reimplementar e quase sempre
 * erra — foco preso dentro do modal, `Esc` para fechar, o resto da página
 * marcado como inerte para leitores de tela, e a camada de topo acima de
 * qualquer `z-index`.
 *
 * A mecânica mora aqui porque tem mais de um consumidor. Duplicá-la é como um
 * modal ganha `Esc` e o outro não.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "~/lib/utils";

interface Props {
	open: boolean;
	/** Título acessível — vira o `aria-labelledby` do diálogo. */
	title: string;
	onClose: () => void;
	/** `true` trava o fechamento enquanto uma ação corre. */
	locked?: boolean;
	className?: string;
	testId?: string;
	children: ReactNode;
	/** Rodapé de ações, alinhado à direita. */
	footer?: ReactNode;
}

export function Dialog({
	open,
	title,
	onClose,
	locked = false,
	className,
	testId = "dialog",
	children,
	footer,
}: Props) {
	const ref = useRef<HTMLDialogElement>(null);
	const titleId = `${testId}-title`;

	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;

		// `showModal()` e não o atributo `open`: só ele ativa a camada de topo, o
		// backdrop e o aprisionamento de foco. `open` renderiza inline, como uma
		// div qualquer.
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	// `Esc` dispara `cancel`; sem interceptar, o `<dialog>` fecharia sozinho e o
	// estado do React continuaria achando que está aberto.
	const handleCancel = useCallback(
		(event: React.SyntheticEvent<HTMLDialogElement>) => {
			event.preventDefault();
			if (!locked) onClose();
		},
		[locked, onClose]
	);

	return (
		<dialog
			ref={ref}
			onCancel={handleCancel}
			className={cn(
				// `m-auto` explícito: o `<dialog>` centraliza com `margin: auto` do
				// user-agent, e o reset do Tailwind zera a margem de tudo — sem isto o
				// modal cola no canto superior esquerdo.
				//
				// A largura vem de `100vw` e não de `100%`: o `<dialog>` na camada de
				// topo não tem o bloco contêiner que `w-full` presume, e com
				// `w-full max-w-md` ele assumia os 448px do `max-w` inteiros — mais
				// largos que um celular de 393px, com o modal saindo pela borda.
				"m-auto w-[calc(100vw-2rem)] max-w-md rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40",
				className
			)}
			data-testid={testId}
			aria-labelledby={titleId}
		>
			<div className="p-6">
				<h2 id={titleId} className="text-base font-semibold text-slate-900">
					{title}
				</h2>

				<div className="mt-4">{children}</div>

				{footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
			</div>
		</dialog>
	);
}
