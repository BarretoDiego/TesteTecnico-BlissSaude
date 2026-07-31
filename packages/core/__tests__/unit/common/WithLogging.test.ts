/**
 * Classes base de logging.
 *
 * O que se testa aqui é o **mapeamento de verbo para nível**: `logFailed` sendo
 * `warn` e não `error` é a diferença entre um alarme de taxa de erro que aponta
 * problemas reais e um que dispara toda vez que alguém consulta um id inexistente.
 */

import { BaseController } from "../../../src/common/BaseController";
import { BaseRepository } from "../../../src/common/BaseRepository";
import { BaseService } from "../../../src/common/BaseService";
import { WithLogging } from "../../../src/common/WithLogging";
import type { BlissLogger } from "../../../src/utils/BlissLogger";

function makeLogger() {
	return { log: jest.fn() } as unknown as jest.Mocked<BlissLogger>;
}

/** Expõe os métodos protegidos para o teste. */
class Probe extends WithLogging {
	start = (...args: Parameters<Probe["logStart"]>) => this.logStart(...args);
	info = (...args: Parameters<Probe["logInfo"]>) => this.logInfo(...args);
	success = (...args: Parameters<Probe["logSuccess"]>) => this.logSuccess(...args);
	warning = (...args: Parameters<Probe["logWarning"]>) => this.logWarning(...args);
	failed = (...args: Parameters<Probe["logFailed"]>) => this.logFailed(...args);
	error = (...args: Parameters<Probe["logError"]>) => this.logError(...args);
}

describe("WithLogging — mapeamento de verbo para nível", () => {
	it.each([
		["start", "debug"],
		["info", "info"],
		["success", "info"],
		["warning", "warn"],
		["failed", "warn"],
		["error", "error"],
	] as const)("log%s emite no nível %s", (verb, level) => {
		const logger = makeLogger();

		new Probe(logger)[verb]("Mod", "act", "mensagem");

		expect(logger.log).toHaveBeenCalledWith(level, "Mod", "act", "mensagem", undefined);
	});

	it("registra falha de negócio como warn, não como error", () => {
		const logger = makeLogger();

		// 404 e 409 são regra de negócio funcionando, não defeito. Emiti-los como
		// `error` polui o alarme de taxa de erro até ele virar ruído ignorado.
		new Probe(logger).failed("RequestsService", "getById", "solicitação não encontrada");

		expect(logger.log).toHaveBeenCalledWith("warn", expect.anything(), expect.anything(), expect.anything(), undefined);
	});

	it("repassa os parâmetros estruturados", () => {
		const logger = makeLogger();

		new Probe(logger).success("Mod", "act", "ok", { id: 7 });

		expect(logger.log).toHaveBeenCalledWith("info", "Mod", "act", "ok", { id: 7 });
	});
});

describe("hierarquia de classes base", () => {
	class Controller extends BaseController {}
	class Service extends BaseService {}
	class Repository extends BaseRepository {}

	it.each([
		["BaseController", Controller],
		["BaseService", Service],
		["BaseRepository", Repository],
	])("%s herda o logging estruturado", (_name, Klass) => {
		// É por herança que toda camada ganha os seis verbos com a mesma
		// assinatura — uniformidade é o que torna os logs consultáveis em agregado.
		expect(new Klass(makeLogger())).toBeInstanceOf(WithLogging);
	});

	it("usa o logger compartilhado quando nenhum é injetado", () => {
		expect(() => new Controller()).not.toThrow();
	});
});
