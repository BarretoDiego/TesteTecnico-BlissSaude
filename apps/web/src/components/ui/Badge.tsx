/**
 * @module web/components/ui/Badge
 */

import type { RequestPriority, RequestStatus } from "@saude-bliss/contracts";
import { REQUEST_PRIORITY_LABELS, REQUEST_STATUS_LABELS } from "@saude-bliss/contracts";
import { cn } from "~/lib/utils";

/**
 * Cores por status.
 *
 * Cor **e** rótulo: cor sozinha exclui quem não a distingue, e é por isso que o
 * texto nunca é omitido.
 */
const STATUS_STYLES: Record<RequestStatus, string> = {
	open: "bg-amber-100 text-amber-800 ring-amber-600/20",
	in_review: "bg-sky-100 text-sky-800 ring-sky-600/20",
	reviewed: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
	rejected: "bg-rose-100 text-rose-800 ring-rose-600/20",
};

const PRIORITY_STYLES: Record<RequestPriority, string> = {
	low: "bg-slate-100 text-slate-700 ring-slate-600/20",
	medium: "bg-blue-100 text-blue-800 ring-blue-600/20",
	high: "bg-orange-100 text-orange-800 ring-orange-600/20",
	critical: "bg-red-100 text-red-800 ring-red-600/20",
};

const BASE = "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset";

export function StatusBadge({ status }: { status: RequestStatus }) {
	return (
		<span className={cn(BASE, STATUS_STYLES[status])} data-testid="badge-status" data-status={status}>
			{REQUEST_STATUS_LABELS[status]}
		</span>
	);
}

export function PriorityBadge({ priority }: { priority: RequestPriority }) {
	return (
		<span className={cn(BASE, PRIORITY_STYLES[priority])} data-testid="badge-priority" data-priority={priority}>
			{REQUEST_PRIORITY_LABELS[priority]}
		</span>
	);
}
