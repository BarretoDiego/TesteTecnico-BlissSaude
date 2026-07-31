"use client";

/**
 * @module web/components/ui/ConfirmDialog
 *
 * Confirmação de ação irreversível.
 *
 * Usa o `<dialog>` nativo em vez de uma `div` com `position: fixed`. Não é
 * preferência: o elemento nativo entrega, sem código, o que uma div exige
 * reimplementar e quase sempre erra — foco preso dentro do modal, `Esc` para
 * fechar, o resto da página marcado como inerte para leitores de tela, e a
 * camada de topo acima de qualquer `z-index`.
 */

import { useCallback, useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

interface Props {
	open: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	/** `danger` para o que destrói ou rejeita; `default` para o resto. */
	tone?: "default" | "danger";
	/** `true` enquanto a ação corre — trava os dois botões. */
	pending?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	tone = "default",
	pending = false,
	onConfirm,
	onCancel,
}: Props) {
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;

		// `showModal()` e não o atributo `open`: só ele ativa a camada de topo, o
		// backdrop e o aprisionamento de foco. `open` renderiza o elemento inline,
		// como se fosse uma div qualquer.
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	// `Esc` dispara `cancel`; sem interceptar, o `<dialog>` fecharia sozinho e o
	// estado do React continuaria achando que está aberto.
	const handleCancel = useCallback(
		(event: React.SyntheticEvent<HTMLDialogElement>) => {
			event.preventDefault();
			if (!pending) onCancel();
		},
		[pending, onCancel]
	);

	return (
		<dialog
			ref={ref}
			onCancel={handleCancel}
			// `m-auto` explícito: o `<dialog>` nativo centraliza com `margin: auto` do
			// user-agent, e o reset do Tailwind zera a margem de tudo — sem isto o
			// modal cola no canto superior esquerdo.
			className="m-auto max-w-md rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
			data-testid="confirm-dialog"
			aria-labelledby="confirm-dialog-title"
		>
			<div className="p-6">
				<h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
					{title}
				</h2>
				<p className="mt-2 text-sm text-slate-600" data-testid="confirm-dialog-description">
					{description}
				</p>

				<div className="mt-6 flex justify-end gap-3">
					<button
						onClick={onCancel}
						disabled={pending}
						className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
						data-testid="confirm-dialog-cancel"
					>
						Cancelar
					</button>
					<button
						onClick={onConfirm}
						disabled={pending}
						// `autoFocus` no confirmar: o `<dialog>` foca o primeiro elemento
						// focável por padrão, e para quem navega por teclado a ação
						// pretendida deve estar a um Enter de distância.
						autoFocus
						className={cn(
							"rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50",
							tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
						)}
						data-testid="confirm-dialog-confirm"
					>
						{pending ? "Registrando…" : confirmLabel}
					</button>
				</div>
			</div>
		</dialog>
	);
}
