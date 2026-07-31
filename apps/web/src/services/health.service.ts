/**
 * @module web/services/health.service
 *
 * Sondas de saúde dos microserviços.
 *
 * Cada Lambda expõe o próprio `/health` sob o prefixo do seu domínio — é o que
 * permite dizer **qual** serviço caiu, e não só que "a API está fora". A tela de
 * status consulta os três em paralelo por esse motivo.
 */

import type { HealthData } from "@saude-bliss/contracts";
import { ApiError, apiClient } from "./instances";

/** Um serviço da malha e o caminho do seu healthcheck. */
export interface ServiceProbe {
	/** Nome do microserviço, como aparece no Terraform e no CloudWatch. */
	name: string;
	path: string;
}

export const SERVICE_PROBES: readonly ServiceProbe[] = [
	{ name: "bliss-requests", path: "/requests/health" },
	{ name: "bliss-reviews", path: "/reviews/health" },
	{ name: "bliss-auth", path: "/auth/health" },
];

/** Resultado da sonda. `data` é nulo quando o serviço não respondeu. */
export interface ProbeResult {
	service: string;
	path: string;
	reachable: boolean;
	data: HealthData | null;
	error?: string;
	requestId?: string;
	durationMs: number;
}

export class HealthService {
	static async probe(target: ServiceProbe): Promise<ProbeResult> {
		const startedAt = Date.now();

		try {
			const { data } = await apiClient.get<HealthData>(target.path);
			return {
				service: target.name,
				path: target.path,
				reachable: true,
				data,
				durationMs: Date.now() - startedAt,
			};
		} catch (caught) {
			// Serviço fora não é erro da tela: é justamente a informação que ela
			// existe para mostrar. Por isso o resultado é devolvido, não relançado.
			const apiError = caught instanceof ApiError ? caught : null;
			return {
				service: target.name,
				path: target.path,
				reachable: false,
				data: null,
				error: apiError?.message ?? "Falha de comunicação",
				requestId: apiError?.requestId,
				durationMs: Date.now() - startedAt,
			};
		}
	}

	/**
	 * Consulta todos os serviços em paralelo.
	 *
	 * Em sequência, um serviço fora seguraria os demais pelo timeout inteiro do
	 * cliente — e a tela de status é exatamente a que precisa responder rápido
	 * quando algo está fora.
	 */
	static async probeAll(): Promise<ProbeResult[]> {
		return Promise.all(SERVICE_PROBES.map((target) => HealthService.probe(target)));
	}
}
