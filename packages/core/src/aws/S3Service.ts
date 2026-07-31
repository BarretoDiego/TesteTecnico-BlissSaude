/**
 * @module core/aws/S3Service
 *
 * Armazenamento de objetos no S3.
 *
 * No domínio deste projeto atende anexos de solicitação e os arquivos de saída
 * da conferência (CSV, relatórios). A regra que a classe impõe: binário **não**
 * trafega pela API. O cliente pede uma URL assinada e envia direto para o S3 —
 * um PDF de 20MB atravessando a Lambda consome memória, duração e o limite de
 * payload do API Gateway (6MB), tudo sem necessidade.
 */

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BaseService } from "../common/BaseService";
import { getAwsClient } from "./AwsClientFactory";

const MODULE = "S3Service";

/** 15 minutos: suficiente para um upload de rede ruim, curto para vazamento. */
const DEFAULT_EXPIRES_IN = 900;

export interface UploadInput {
	bucket: string;
	key: string;
	body: Buffer | Uint8Array | string;
	contentType?: string;
	metadata?: Record<string, string>;
}

export class S3Service extends BaseService {
	private get client(): S3Client {
		return getAwsClient("s3", (config) => new S3Client({ ...config, forcePathStyle: Boolean(config.endpoint) }));
	}

	/**
	 * Envia um objeto a partir do próprio serviço.
	 *
	 * Apropriado para artefato pequeno gerado no servidor — um CSV de conferência,
	 * um relatório. Para arquivo enviado por pessoa, use `getUploadUrl`.
	 */
	async upload(input: UploadInput): Promise<string> {
		this.logStart(MODULE, "upload", "enviando objeto", { bucket: input.bucket, key: input.key });

		await this.client.send(
			new PutObjectCommand({
				Bucket: input.bucket,
				Key: input.key,
				Body: input.body,
				...(input.contentType ? { ContentType: input.contentType } : {}),
				...(input.metadata ? { Metadata: input.metadata } : {}),
			})
		);

		this.logSuccess(MODULE, "upload", "objeto enviado", { bucket: input.bucket, key: input.key });
		return `s3://${input.bucket}/${input.key}`;
	}

	/** URL assinada para o cliente enviar o arquivo direto ao S3. */
	async getUploadUrl(bucket: string, key: string, expiresIn = DEFAULT_EXPIRES_IN): Promise<string> {
		return getSignedUrl(this.client, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
	}

	/**
	 * URL assinada de leitura.
	 *
	 * Preferível a tornar o bucket público: o acesso expira, é rastreável e não
	 * depende de ninguém lembrar de revisar a policy do bucket depois.
	 */
	async getDownloadUrl(bucket: string, key: string, expiresIn = DEFAULT_EXPIRES_IN): Promise<string> {
		return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
	}

	async delete(bucket: string, key: string): Promise<void> {
		this.logStart(MODULE, "delete", "removendo objeto", { bucket, key });
		await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
		this.logSuccess(MODULE, "delete", "objeto removido", { bucket, key });
	}
}

export const s3Service = new S3Service();
