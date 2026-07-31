/**
 * @module web/lib/utils
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Concatena classes resolvendo conflitos do Tailwind.
 *
 * `clsx` monta a lista condicional; `twMerge` desempata — sem ele,
 * `cn("p-2", "p-4")` produz as duas e o resultado depende da ordem no CSS.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** Data e hora no formato brasileiro, curto. */
export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
