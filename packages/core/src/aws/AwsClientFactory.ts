/**
 * @module core/aws/AwsClientFactory
 *
 * Construção de clientes do AWS SDK.
 *
 * Todos os serviços de integração passam por aqui para que **uma** decisão sobre
 * região e endpoint valha para todos. É o que faz a mesma linha de código falar
 * com o LocalStack em desenvolvimento e com a AWS real em produção: só a
 * variável `AWS_ENDPOINT_URL` muda.
 *
 * Os clientes são cacheados por tipo em escopo de módulo. Em Lambda isso importa
 * mais do que parece: instanciar um cliente do SDK resolve credenciais e monta o
 * pool HTTP, e refazer isso a cada requisição adiciona dezenas de milissegundos
 * a toda invocação quente.
 */

import { envService } from "../config/EnvService";

/** Configuração comum a qualquer cliente do SDK v3. */
export interface AwsClientConfig {
	region: string;
	endpoint?: string;
	/**
	 * O LocalStack aceita qualquer credencial, mas o SDK exige que existam. Em
	 * AWS real este campo fica ausente e a cadeia padrão de credenciais assume
	 * (variáveis de ambiente, role da Lambda, perfil local).
	 */
	credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function buildAwsClientConfig(): AwsClientConfig {
	const endpoint = envService.getAwsEndpoint();

	return {
		region: envService.getRegion(),
		...(endpoint ? { endpoint } : {}),
		...(endpoint ? { credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {}),
	};
}

const cache = new Map<string, unknown>();

/**
 * Cliente cacheado por chave.
 *
 * A `factory` só é chamada uma vez por processo. Serviços declaram o cliente
 * como getter preguiçoso sobre esta função, de modo que um serviço nunca usado
 * também nunca carrega credenciais nem abre socket.
 */
export function getAwsClient<TClient>(key: string, factory: (config: AwsClientConfig) => TClient): TClient {
	const cached = cache.get(key);
	if (cached) return cached as TClient;

	const client = factory(buildAwsClientConfig());
	cache.set(key, client);
	return client;
}

/** Limpa o cache. Existe para os testes — nunca chamado em runtime. */
export function resetAwsClients(): void {
	cache.clear();
}
