"use client";

/**
 * @module web/app/backoffice/solicitacoes/nova
 *
 * Abertura de solicitação — a tela de `POST /requests`.
 *
 * Valida no cliente com o **mesmo** schema que a API usa (`CreateRequestPayloadSchema`
 * de `@saude-bliss/contracts`), então as mensagens são idênticas dos dois lados e
 * não existe a classe de bug em que o front aceita o que o back recusa. A
 * validação local é conveniência, não defesa: o servidor valida de novo, e os
 * erros que vierem de lá são exibidos no campo correspondente.
 */

import type { Request as RequestDto } from "@saude-bliss/contracts";
import { CreateRequestPayloadSchema, REQUEST_PRIORITIES, REQUEST_PRIORITY_LABELS } from "@saude-bliss/contracts";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { RequestIdBadge } from "~/components/shared/RequestIdBadge";
import { PriorityBadge, StatusBadge } from "~/components/ui/Badge";
import { useSession } from "~/providers/SessionProvider";
import { ApiError } from "~/services/instances";
import { RequestsService } from "~/services/requests.service";

type FieldErrors = Partial<Record<"title" | "description" | "priority" | "createdBy", string>>;

/**
 * Converte os `details` do envelope de erro em erros por campo.
 *
 * O caminho chega como `title` (validação Zod no middleware) ou `body.title`
 * (validação do Fastify, que roda antes) — normalizar os dois evita que a
 * mensagem apareça na tela solta, sem campo associado.
 */
function toFieldErrors(details: unknown): FieldErrors {
	if (!Array.isArray(details)) return {};

	const errors: FieldErrors = {};
	for (const issue of details) {
		if (typeof issue !== "object" || issue === null) continue;
		const { field, message } = issue as { field?: unknown; message?: unknown };
		if (typeof field !== "string" || typeof message !== "string") continue;

		const key = field.replace(/^body\./, "");
		if (key === "title" || key === "description" || key === "priority" || key === "createdBy") {
			errors[key] = message;
		}
	}
	return errors;
}

export default function NovaSolicitacaoPage() {
	const { user } = useSession();

	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [priority, setPriority] = useState<(typeof REQUEST_PRIORITIES)[number]>("medium");
	// Editável de propósito: abrir em nome de outra pessoa é o que permite testar
	// o filtro `?createdBy=` sem precisar trocar de usuário.
	const [createdBy, setCreatedBy] = useState(user?.email ?? "");

	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [errorRequestId, setErrorRequestId] = useState<string>();
	const [created, setCreated] = useState<RequestDto | null>(null);
	const [submitting, setSubmitting] = useState(false);

	function reset() {
		setTitle("");
		setDescription("");
		setPriority("medium");
		setCreatedBy(user?.email ?? "");
		setFieldErrors({});
		setFormError(null);
		setErrorRequestId(undefined);
		setCreated(null);
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setFieldErrors({});
		setFormError(null);
		setErrorRequestId(undefined);
		setCreated(null);

		const parsed = CreateRequestPayloadSchema.safeParse({ title, description, priority, createdBy });
		if (!parsed.success) {
			const errors: FieldErrors = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0];
				if (key === "title" || key === "description" || key === "priority" || key === "createdBy") {
					errors[key] = issue.message;
				}
			}
			setFieldErrors(errors);
			return;
		}

		setSubmitting(true);
		try {
			setCreated(await RequestsService.create(parsed.data));
		} catch (caught) {
			const apiError = caught instanceof ApiError ? caught : null;
			setFormError(apiError?.message ?? "Falha ao abrir a solicitação");
			setErrorRequestId(apiError?.requestId);
			setFieldErrors(toFieldErrors(apiError?.details));
		} finally {
			setSubmitting(false);
		}
	}

	if (created) {
		return (
			<div className="space-y-6" data-testid="nova-solicitacao-sucesso" data-request-id={created.id}>
				<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
					<h1 className="text-lg font-semibold text-emerald-900">Solicitação aberta</h1>
					<p className="mt-1 text-sm text-emerald-800" data-testid="sucesso-titulo">
						{created.title}
					</p>

					<dl className="mt-5 grid grid-cols-2 gap-4 border-t border-emerald-200 pt-4 text-sm sm:grid-cols-4">
						<div>
							<dt className="text-xs text-emerald-700">Identificador</dt>
							<dd className="font-mono text-xs" data-testid="sucesso-id">
								{created.id}
							</dd>
						</div>
						<div>
							<dt className="text-xs text-emerald-700">Situação</dt>
							<dd>
								<StatusBadge status={created.status} />
							</dd>
						</div>
						<div>
							<dt className="text-xs text-emerald-700">Prioridade</dt>
							<dd>
								<PriorityBadge priority={created.priority} />
							</dd>
						</div>
						<div>
							{/*
							 * O `createdTraceId` é o `x-request-id` que o browser gerou nesta
							 * chamada, gravado na linha do banco. Exibi-lo aqui fecha o
							 * circuito visualmente: o mesmo valor está no CloudWatch.
							 */}
							<dt className="text-xs text-emerald-700">Trace da criação</dt>
							<dd className="font-mono text-xs" data-testid="sucesso-trace">
								{created.createdTraceId ?? "—"}
							</dd>
						</div>
					</dl>
				</div>

				<div className="flex flex-wrap gap-3">
					<Link
						href={`/solicitacoes/${created.id}`}
						className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
						data-testid="sucesso-ver-detalhe"
					>
						Ver a solicitação
					</Link>
					<button
						onClick={reset}
						className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
						data-testid="sucesso-abrir-outra"
					>
						Abrir outra
					</button>
					<Link
						href="/solicitacoes"
						className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
					>
						Voltar para a listagem
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Nova solicitação</h1>
					<p className="mt-1 text-sm text-slate-500">
						<code className="font-mono text-xs">POST /requests</code>
					</p>
				</div>
				<RequestIdBadge requestId={errorRequestId} />
			</div>

			<form
				onSubmit={handleSubmit}
				noValidate
				className="max-w-2xl space-y-5 rounded-lg border border-slate-200 bg-white p-6"
				data-testid="nova-solicitacao-form"
			>
				<label className="block space-y-1.5">
					<span className="text-sm font-medium">Título</span>
					<input
						type="text"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Resumo do que está sendo pedido"
						className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
						data-testid="nova-title"
					/>
					{fieldErrors.title && (
						<span className="block text-xs text-rose-600" data-testid="erro-title">
							{fieldErrors.title}
						</span>
					)}
				</label>

				<label className="block space-y-1.5">
					<span className="text-sm font-medium">Descrição</span>
					<textarea
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						rows={5}
						placeholder="Contexto, o que já foi tentado e o que se espera como desfecho"
						className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
						data-testid="nova-description"
					/>
					{fieldErrors.description && (
						<span className="block text-xs text-rose-600" data-testid="erro-description">
							{fieldErrors.description}
						</span>
					)}
				</label>

				<div className="grid gap-5 sm:grid-cols-2">
					<label className="block space-y-1.5">
						<span className="text-sm font-medium">Prioridade</span>
						<select
							value={priority}
							onChange={(event) => setPriority(event.target.value as (typeof REQUEST_PRIORITIES)[number])}
							className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
							data-testid="nova-priority"
						>
							{REQUEST_PRIORITIES.map((option) => (
								<option key={option} value={option}>
									{REQUEST_PRIORITY_LABELS[option]}
								</option>
							))}
						</select>
						{fieldErrors.priority && (
							<span className="block text-xs text-rose-600" data-testid="erro-priority">
								{fieldErrors.priority}
							</span>
						)}
					</label>

					<label className="block space-y-1.5">
						<span className="text-sm font-medium">Solicitante</span>
						<input
							type="email"
							value={createdBy}
							onChange={(event) => setCreatedBy(event.target.value)}
							placeholder="email@saudebliss.test"
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
							data-testid="nova-createdBy"
						/>
						{fieldErrors.createdBy && (
							<span className="block text-xs text-rose-600" data-testid="erro-createdBy">
								{fieldErrors.createdBy}
							</span>
						)}
					</label>
				</div>

				{formError && (
					<p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert" data-testid="nova-erro">
						{formError}
					</p>
				)}

				<div className="flex gap-3 border-t border-slate-100 pt-5">
					<button
						type="submit"
						disabled={submitting}
						className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
						data-testid="nova-submit"
					>
						{submitting ? "Abrindo…" : "Abrir solicitação"}
					</button>
					<Link
						href="/solicitacoes"
						className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
						data-testid="nova-cancelar"
					>
						Cancelar
					</Link>
				</div>
			</form>
		</div>
	);
}
