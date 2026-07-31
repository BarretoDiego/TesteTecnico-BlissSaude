/**
 * @module web/components/shared/RequestIdBadge
 *
 * Exibe o `requestId` da última resposta.
 *
 * Pequeno e paga por si duas vezes: torna a rastreabilidade visível para quem
 * está olhando a tela — dá para copiar o id e achar a requisição no CloudWatch —
 * e dá à suíte Playwright um alvo determinístico para afirmar que o id enviado
 * é o mesmo que voltou.
 */

export function RequestIdBadge({ requestId }: { requestId?: string }) {
	if (!requestId) return null;

	return (
		<span
			className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600"
			data-testid="request-id-badge"
			data-request-id={requestId}
			title="Identificador desta requisição nos logs"
		>
			<span className="text-slate-400">trace</span>
			{requestId}
		</span>
	);
}
