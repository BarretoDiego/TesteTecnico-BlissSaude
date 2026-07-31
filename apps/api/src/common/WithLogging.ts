/**
 * @module api/common/WithLogging
 *
 * Classe base que dá logging estruturado a qualquer camada por herança.
 *
 * Padrão da casa: `BaseController`, `BaseService` e `BaseRepository` estendem
 * daqui, então toda classe de domínio já nasce com os seis verbos de log e a
 * mesma assinatura `(module, action, message, params?)`. Uniformidade de
 * assinatura é o que torna os logs consultáveis de forma agregada.
 */

import { logger, type LogParams, type SBLogger } from "@/utils/SBLogger";

export abstract class WithLogging {
	protected readonly logger: SBLogger;

	constructor(injectedLogger: SBLogger = logger) {
		this.logger = injectedLogger;
	}

	/** Início de uma operação. Emparelha com `logSuccess` ou `logError`. */
	protected logStart(module: string, action: string, message: string, params?: LogParams): void {
		this.logger.log("debug", module, action, message, params);
	}

	protected logInfo(module: string, action: string, message: string, params?: LogParams): void {
		this.logger.log("info", module, action, message, params);
	}

	protected logSuccess(module: string, action: string, message: string, params?: LogParams): void {
		this.logger.log("info", module, action, message, params);
	}

	protected logWarning(module: string, action: string, message: string, params?: LogParams): void {
		this.logger.log("warn", module, action, message, params);
	}

	/** Falha esperada de negócio (404, transição inválida) — não é defeito. */
	protected logFailed(module: string, action: string, message: string, params?: LogParams): void {
		this.logger.log("warn", module, action, message, params);
	}

	/** Falha inesperada. Só aqui para não poluir o alarme de taxa de erro. */
	protected logError(module: string, action: string, message: string, params?: LogParams): void {
		this.logger.log("error", module, action, message, params);
	}
}
