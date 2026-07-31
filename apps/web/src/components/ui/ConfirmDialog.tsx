"use client";

/**
 * @module web/components/ui/ConfirmDialog
 *
 * Confirmação de ação irreversível. A mecânica do modal vem de `Dialog`; aqui
 * fica só o que é próprio de confirmar: as duas ações e o tom.
 */

import { cn } from "~/lib/utils";
import { Dialog } from "./Dialog";

interface Props {
	open: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	/** `danger` para o que destrói ou rejeita; `default` para o resto. */
	tone?: "default" | "danger";
	/** `true` enquanto a ação corre — trava os dois botões e o `Esc`. */
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
	return (
		<Dialog
			open={open}
			title={title}
			onClose={onCancel}
			locked={pending}
			testId="confirm-dialog"
			footer={
				<>
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
				</>
			}
		>
			<p className="text-sm text-slate-600" data-testid="confirm-dialog-description">
				{description}
			</p>
		</Dialog>
	);
}
