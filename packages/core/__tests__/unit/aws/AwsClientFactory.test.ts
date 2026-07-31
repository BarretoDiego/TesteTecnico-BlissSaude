/**
 * Construção e cache dos clientes do SDK.
 *
 * O que se verifica aqui é o que faz a mesma linha de código falar com o
 * LocalStack em desenvolvimento e com a AWS real em produção, e o cache que
 * evita pagar resolução de credenciais a cada invocação quente da Lambda.
 */

import { buildAwsClientConfig, getAwsClient, resetAwsClients } from "../../../src/aws/AwsClientFactory";

const ORIGINAL = { ...process.env };

beforeEach(() => {
	resetAwsClients();
	delete process.env.AWS_ENDPOINT_URL;
	delete process.env.AWS_REGION;
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("buildAwsClientConfig", () => {
	it("usa a região do ambiente", () => {
		process.env.AWS_REGION = "sa-east-1";

		expect(buildAwsClientConfig().region).toBe("sa-east-1");
	});

	it("não define endpoint nem credenciais sem AWS_ENDPOINT_URL", () => {
		const config = buildAwsClientConfig();

		// Em AWS real a cadeia padrão de credenciais precisa assumir — a role da
		// Lambda. Injetar credenciais falsas aqui quebraria toda chamada.
		expect(config.endpoint).toBeUndefined();
		expect(config.credentials).toBeUndefined();
	});

	it("define endpoint e credenciais de teste quando aponta para o LocalStack", () => {
		process.env.AWS_ENDPOINT_URL = "http://localhost:4568";

		const config = buildAwsClientConfig();

		// O LocalStack aceita qualquer credencial, mas o SDK exige que existam:
		// sem elas o cliente falha antes de sair da máquina.
		expect(config.endpoint).toBe("http://localhost:4568");
		expect(config.credentials).toEqual({ accessKeyId: "test", secretAccessKey: "test" });
	});
});

describe("getAwsClient", () => {
	it("constrói o cliente uma vez e devolve o mesmo nas chamadas seguintes", () => {
		const factory = jest.fn().mockImplementation(() => ({ id: Math.random() }));

		const primeiro = getAwsClient("servico", factory);
		const segundo = getAwsClient("servico", factory);

		// Em Lambda isso é performance de verdade: instanciar um cliente resolve
		// credenciais e monta o pool HTTP, dezenas de ms por invocação.
		expect(factory).toHaveBeenCalledTimes(1);
		expect(segundo).toBe(primeiro);
	});

	it("mantém clientes distintos por chave", () => {
		const s3 = getAwsClient("s3", () => ({ nome: "s3" }));
		const sqs = getAwsClient("sqs", () => ({ nome: "sqs" }));

		expect(s3).not.toBe(sqs);
	});

	it("passa a configuração resolvida para a factory", () => {
		process.env.AWS_ENDPOINT_URL = "http://localhost:4568";
		const factory = jest.fn().mockReturnValue({});

		getAwsClient("qualquer", factory);

		expect(factory).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "http://localhost:4568" }));
	});

	it("reconstrói depois do reset", () => {
		const factory = jest.fn().mockImplementation(() => ({ id: Math.random() }));

		const antes = getAwsClient("servico", factory);
		resetAwsClients();
		const depois = getAwsClient("servico", factory);

		// É o que permite a um teste trocar a configuração sem herdar o cliente
		// construído pelo teste anterior.
		expect(factory).toHaveBeenCalledTimes(2);
		expect(depois).not.toBe(antes);
	});
});
