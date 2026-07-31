/**
 * @module core/app/defineService
 *
 * Definição de um microserviço.
 *
 * Um objeto só, consumido tanto por `createApp` (uma Lambda por domínio) quanto
 * por `createAggregatedApp` (todos num processo, para desenvolvimento). Antes o
 * nome, o prefixo e a tag eram repetidos nos dois lugares, o que é exatamente o
 * tipo de duplicação que deixa os modos divergirem sem ninguém notar.
 */

import type { HealthProbe } from "./healthRoute";
import type { DomainRouter } from "./router";

export interface ServiceDefinition {
	/** Nome do microserviço, ex.: `bliss-requests`. Vai para Swagger, logs e Lambda. */
	name: string;
	/** Descrição exibida no Swagger. */
	description: string;
	/**
	 * Prefixo do domínio, ex.: `/requests`. Agrupa **todas** as rotas do serviço.
	 *
	 * Com cada Lambda dona de um prefixo distinto, o API Gateway roteia por um
	 * recurso `{proxy+}` por função. Se duas dividissem o mesmo prefixo, seria
	 * preciso uma regra por método para desempatar, e toda rota nova exigiria
	 * mexer no roteamento da infraestrutura.
	 */
	routePrefix: string;
	/** Tabela de rotas do domínio. */
	router: DomainRouter;
	/** Tag do OpenAPI que agrupa as rotas. Default: prefixo sem a barra. */
	tag?: string;
	/**
	 * Verificação de dependências para o `/health`. Opcional: um serviço sem
	 * dependência externa responde saudável só por estar de pé.
	 */
	healthProbe?: HealthProbe;
}

/**
 * Declara um microserviço.
 *
 * Existe pela checagem de tipo no ponto da declaração — sem ela, um campo
 * errado só apareceria lá no consumidor, com mensagem pior.
 */
export function defineService(definition: ServiceDefinition): ServiceDefinition {
	return definition;
}

/** Tag do OpenAPI do serviço, derivada do prefixo quando não informada. */
export function serviceTag(definition: ServiceDefinition): string {
	return definition.tag ?? definition.routePrefix.replace(/^\//, "");
}
