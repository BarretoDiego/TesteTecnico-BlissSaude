"use client";

/**
 * @module web/app/backoffice/status
 *
 * Estado da malha de microserviços.
 *
 * Existe por dois motivos. O operacional: quando o backoffice falha, esta tela
 * diz **qual** Lambda está fora em vez de deixar o diagnóstico para o console do
 * browser. E o de verificação: junto com as demais telas, ela fecha a cobertura
 * de todas as rotas publicadas — os três `/health` e o `GET /auth/me`, que
 * nenhuma outra tela exercita explicitamente.
 */

import type { AuthenticatedUser } from "@saude-bliss/contracts";
import { useCallback, useEffect, useState } from "react";
import { AuthService } from "~/services/auth.service";
import { HealthService, type ProbeResult } from "~/services/health.service";
import { ApiError } from "~/services/instances";

interface IdentityCheck {
	user: AuthenticatedUser | null;
	error?: string;
	requestId?: string;
}

export default function StatusPage() {
	const [probes, setProbes] = useState<ProbeResult[] | null>(null);
	const [identity, setIdentity] = useState<IdentityCheck | null>(null);
	const [loading, setLoading] = useState(true);
	const [checkedAt, setCheckedAt] = useState<string | null>(null);

	const check = useCallback(async () => {
		setLoading(true);

		// As sondas e a identidade correm juntas: são independentes, e sequenciá-las
		// só somaria latência a uma tela cujo propósito é responder rápido.
		const [results, me] = await Promise.all([
			HealthService.probeAll(),
			AuthService.me()
				.then((user): IdentityCheck => ({ user }))
				.catch((caught: unknown): IdentityCheck => {
					const apiError = caught instanceof ApiError ? caught : null;
					return {
						user: null,
						error: apiError?.message ?? "Falha ao consultar a identidade",
						requestId: apiError?.requestId,
					};
				}),
		]);

		setProbes(results);
		setIdentity(me);
		setCheckedAt(new Date().toLocaleTimeString("pt-BR"));
		setLoading(false);
	}, []);

	useEffect(() => {
		void check();
	}, [check]);

	const allUp = probes?.every((probe) => probe.reachable && probe.data?.status === "ok") ?? false;

	return (
		<div className="space-y-6" data-testid="status-page" data-loading={String(loading)} data-all-up={String(allUp)}>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Status dos serviços</h1>
					<p className="mt-1 text-sm text-slate-500">{checkedAt ? `Verificado às ${checkedAt}` : "Verificando…"}</p>
				</div>
				<button
					onClick={() => void check()}
					disabled={loading}
					className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
					data-testid="status-recheck"
				>
					{loading ? "Verificando…" : "Verificar novamente"}
				</button>
			</div>

			{/*
			 * `overflow-x-auto` e não `overflow-hidden`: são seis colunas que não
			 * cabem em tela de celular, e esconder o excesso deixava as três últimas
			 * — situação, ambiente e tempo de resposta — inalcançáveis justamente
			 * quando alguém abre esta tela do celular para saber o que caiu.
			 */}
			<section className="overflow-x-auto rounded-lg border border-slate-200 bg-white" data-testid="status-table">
				<table className="w-full min-w-3xl text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
						<tr>
							<th className="px-4 py-3 font-medium">Microserviço</th>
							<th className="px-4 py-3 font-medium">Rota</th>
							<th className="px-4 py-3 font-medium">Situação</th>
							<th className="px-4 py-3 font-medium">Dependências</th>
							<th className="px-4 py-3 font-medium">Ambiente</th>
							<th className="px-4 py-3 text-right font-medium">Resposta</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{(probes ?? []).map((probe) => (
							<tr
								key={probe.service}
								data-testid={`status-row-${probe.service}`}
								data-reachable={String(probe.reachable)}
							>
								<td className="px-4 py-3 font-medium">{probe.service}</td>
								<td className="px-4 py-3 font-mono text-xs text-slate-500">{probe.path}</td>
								<td className="px-4 py-3">
									<span
										className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
											probe.data?.status === "ok"
												? "bg-emerald-100 text-emerald-800 ring-emerald-600/20"
												: "bg-rose-100 text-rose-800 ring-rose-600/20"
										}`}
										data-testid={`status-badge-${probe.service}`}
									>
										{probe.data?.status ?? "fora"}
									</span>
								</td>
								<td className="px-4 py-3 text-slate-600">{probe.data?.dependencies ?? probe.error ?? "—"}</td>
								<td className="px-4 py-3 text-slate-600">{probe.data?.env ?? "—"}</td>
								<td className="px-4 py-3 text-right font-mono text-xs text-slate-500">{probe.durationMs}ms</td>
							</tr>
						))}

						{loading && !probes && (
							<tr>
								<td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
									Consultando os serviços…
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>

			<section className="rounded-lg border border-slate-200 bg-white p-6" data-testid="status-identidade">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
					Identidade — <code className="font-mono text-xs normal-case">GET /auth/me</code>
				</h2>

				{identity?.user ? (
					/*
					 * `min-w-0` e `break-words` nas células, como no detalhe: item de grid
					 * nasce com `min-width: auto`, e um e-mail — que não tem onde quebrar —
					 * transborda a coluna. O texto não aumenta a caixa, então nada parece
					 * fora do lugar: o que aparece é a página inteira ganhando rolagem
					 * horizontal, sete pixels a mais que a largura da tela.
					 */
					<dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
						<div className="min-w-0">
							<dt className="text-xs text-slate-500">Nome</dt>
							<dd className="break-words" data-testid="identidade-nome">
								{identity.user.name}
							</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-xs text-slate-500">E-mail</dt>
							<dd className="break-words" data-testid="identidade-email">
								{identity.user.email}
							</dd>
						</div>
						<div className="min-w-0">
							<dt className="text-xs text-slate-500">Perfis</dt>
							<dd className="break-words" data-testid="identidade-perfis">
								{identity.user.roles.join(", ")}
							</dd>
						</div>
					</dl>
				) : (
					<p className="mt-4 text-sm text-slate-500" data-testid="identidade-erro">
						{identity?.error ?? "Consultando…"}
					</p>
				)}
			</section>
		</div>
	);
}
