/**
 * Armazenamento de objetos.
 *
 * A regra que a classe impõe — binário não trafega pela API — se materializa nas
 * URLs assinadas. É isso, mais o `forcePathStyle` que faz o LocalStack funcionar,
 * o que se verifica aqui.
 */

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { resetAwsClients } from "../../../src/aws/AwsClientFactory";
import { S3Service } from "../../../src/aws/S3Service";

const s3Mock = mockClient(S3Client);
const service = new S3Service();

const ORIGINAL = { ...process.env };

beforeEach(() => {
	s3Mock.reset();
	resetAwsClients();
	delete process.env.AWS_ENDPOINT_URL;
	s3Mock.onAnyCommand().resolves({});
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("S3Service.upload", () => {
	it("envia o objeto e devolve a URI", async () => {
		await expect(
			service.upload({ bucket: "bliss-anexos", key: "conferencia/2026-07-31.csv", body: "a,b,c" })
		).resolves.toBe("s3://bliss-anexos/conferencia/2026-07-31.csv");
	});

	it("omite content-type e metadados quando não informados", async () => {
		await service.upload({ bucket: "b", key: "k", body: "x" });

		// Mandar `ContentType: undefined` faz o SDK serializar o header vazio, e o
		// objeto sai com tipo inválido em vez de sem tipo.
		const { args } = s3Mock.commandCalls(PutObjectCommand)[0]!;
		expect(args[0].input).not.toHaveProperty("ContentType");
		expect(args[0].input).not.toHaveProperty("Metadata");
	});

	it("repassa content-type e metadados quando informados", async () => {
		await service.upload({
			bucket: "b",
			key: "k",
			body: "x",
			contentType: "text/csv",
			metadata: { origem: "conferencia" },
		});

		const { args } = s3Mock.commandCalls(PutObjectCommand)[0]!;
		expect(args[0].input).toMatchObject({ ContentType: "text/csv", Metadata: { origem: "conferencia" } });
	});

	it("propaga a falha", async () => {
		s3Mock.on(PutObjectCommand).rejects(new Error("acesso negado"));

		// Diferente de evento e fila: aqui o objeto **é** o resultado pedido, não
		// efeito colateral. Engolir a falha devolveria uma URI que não existe.
		await expect(service.upload({ bucket: "b", key: "k", body: "x" })).rejects.toThrow("acesso negado");
	});
});

describe("S3Service — URLs assinadas", () => {
	/**
	 * Assinar exige credencial de verdade: o presigner monta a assinatura
	 * localmente, sem passar pelo `mockClient`. Apontar para o endpoint é o que
	 * injeta as credenciais de teste — e é exatamente o cenário em que este
	 * projeto exercita o S3.
	 */
	function assinador() {
		process.env.AWS_ENDPOINT_URL = "http://localhost:4568";
		resetAwsClients();
		return new S3Service();
	}

	it("assina URL de escrita com validade", async () => {
		const url = await assinador().getUploadUrl("bliss-anexos", "laudo.pdf");

		// A URL assinada é o que mantém um PDF de 20MB fora da Lambda — o limite
		// de payload do API Gateway é 6MB.
		expect(url).toContain("bliss-anexos");
		expect(url).toContain("X-Amz-Expires=900");
	});

	it("assina URL de leitura", async () => {
		const url = await assinador().getDownloadUrl("bliss-anexos", "laudo.pdf");

		expect(url).toContain("laudo.pdf");
		expect(url).toContain("X-Amz-Signature");
	});

	it("respeita a validade informada", async () => {
		const url = await assinador().getDownloadUrl("bliss-anexos", "laudo.pdf", 60);

		expect(url).toContain("X-Amz-Expires=60");
	});

	it("usa path-style quando aponta para o LocalStack", async () => {
		const url = await assinador().getDownloadUrl("bliss-anexos", "laudo.pdf");

		// Sem `forcePathStyle` o SDK monta `bliss-anexos.localhost`, que não
		// resolve — o bucket precisa ir no caminho.
		expect(url).toContain("localhost:4568/bliss-anexos/laudo.pdf");
	});
});

describe("S3Service.delete", () => {
	it("remove o objeto", async () => {
		await service.delete("bliss-anexos", "laudo.pdf");

		const { args } = s3Mock.commandCalls(DeleteObjectCommand)[0]!;
		expect(args[0].input).toMatchObject({ Bucket: "bliss-anexos", Key: "laudo.pdf" });
	});
});
