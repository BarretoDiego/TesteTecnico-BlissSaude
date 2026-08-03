/**
 * Contrato do `/health`.
 *
 * Tem dois lados: o `core` produz a resposta e a tela de status a consome. É por
 * isso que vive em `contracts` — e é por isso que a forma precisa ser verificada
 * aqui, e não só na ponta que a escreve.
 */

import { HealthDataSchema } from "../src/health.schema";

const saudavel = {
	service: "bliss-requests",
	status: "ok" as const,
	env: "local",
	dependencies: "up" as const,
	uptimeSeconds: 42,
	version: "1.0.0",
};

describe("HealthDataSchema", () => {
	it("aceita a resposta saudável", () => {
		expect(HealthDataSchema.parse(saudavel)).toEqual(saudavel);
	});

	it("aceita a resposta degradada", () => {
		expect(HealthDataSchema.safeParse({ ...saudavel, status: "degraded", dependencies: "down" }).success).toBe(true);
	});

	it.each([
		["status", "healthy"],
		["status", "OK"],
	])("recusa %s fora do vocabulário: %p", (campo, valor) => {
		// A tela de status ramifica na string exata. Um terceiro valor cairia no
		// caminho de "fora do ar" sem nada indicar por quê.
		expect(HealthDataSchema.safeParse({ ...saudavel, [campo]: valor }).success).toBe(false);
	});

	it.each(["upp", "DOWN", "unknown"])("recusa dependências como %p", (dependencies) => {
		expect(HealthDataSchema.safeParse({ ...saudavel, dependencies }).success).toBe(false);
	});

	it("exige uptime numérico", () => {
		expect(HealthDataSchema.safeParse({ ...saudavel, uptimeSeconds: "42" }).success).toBe(false);
	});

	it("aceita uptime zero", () => {
		// Cold start responde no primeiro segundo; recusar zero faria o healthcheck
		// falhar exatamente quando a função acabou de subir.
		expect(HealthDataSchema.safeParse({ ...saudavel, uptimeSeconds: 0 }).success).toBe(true);
	});

	it.each(["service", "status", "env", "dependencies", "uptimeSeconds", "version"])("exige o campo %s", (campo) => {
		const payload: Record<string, unknown> = { ...saudavel };
		delete payload[campo];

		expect(HealthDataSchema.safeParse(payload).success).toBe(false);
	});

	it("identifica qual serviço respondeu", () => {
		// É o que permite à tela de status dizer **qual** Lambda caiu em vez de
		// "a API falhou".
		expect(HealthDataSchema.parse({ ...saudavel, service: "bliss-auth" }).service).toBe("bliss-auth");
	});
});
