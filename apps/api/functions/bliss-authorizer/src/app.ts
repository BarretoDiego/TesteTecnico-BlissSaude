/**
 * @module bliss-authorizer/app
 *
 * Microserviço authorizer — porta de entrada de autenticação das demais Lambdas.
 *
 * Diferente dos outros serviços, este **não** é uma aplicação HTTP: o API Gateway
 * o invoca antes de encaminhar a requisição e espera de volta um documento de
 * política IAM. Por isso não usa `createApp` — usa `createAuthorizerHandler`, que
 * dá o mesmo tratamento de fronteira (contexto de requisição, `requestId`,
 * logging estruturado) para um contrato de entrada e saída diferente.
 *
 * O `context` devolvido chega às Lambdas de domínio em
 * `event.requestContext.authorizer`, então elas sabem quem chamou sem revalidar
 * nada — a validação aconteceu uma vez, aqui.
 */

import { createAuthorizerHandler, type AuthorizedPrincipal, type AuthorizerEvent } from "@saude-bliss/core";
import { TokenService } from "./services/TokenService";

export const SERVICE_NAME = "bliss-authorizer";

/**
 * Instância em escopo de módulo: mantém a chave de assinatura em cache entre
 * invocações no mesmo container, o que evita uma ida ao Secrets Manager por
 * autenticação.
 */
const tokenService = new TokenService();

export async function authorize(event: AuthorizerEvent): Promise<AuthorizedPrincipal> {
	const token = tokenService.extractToken(event.headers ?? {});
	const claims = await tokenService.verify(token);

	return {
		principalId: claims.sub,
		/**
		 * Só valores escalares: o API Gateway descarta objeto aninhado em silêncio,
		 * e a Lambda de domínio receberia `undefined` sem nenhum aviso. Por isso os
		 * papéis viram string separada por vírgula em vez de array.
		 */
		context: {
			userId: claims.sub,
			email: claims.email ?? "",
			roles: (claims.roles ?? []).join(","),
		},
	};
}

/** Handler consumido pela AWS Lambda (`dist/app.lambdaHandler`). */
export const lambdaHandler = createAuthorizerHandler(authorize);

export { tokenService };
