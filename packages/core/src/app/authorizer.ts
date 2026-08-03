/**
 * @module core/app/authorizer
 *
 * Adaptador para Lambda authorizer do API Gateway.
 *
 * Equivale ao `createLambdaHandler` das funções HTTP: cuida da fronteira —
 * normaliza o id de correlação, entra no contexto assíncrono, loga de forma
 * estruturada e monta o documento de política — para que o serviço de autorização
 * declare apenas **como validar o token**.
 *
 * ## Por que um authorizer separado
 *
 * A alternativa seria cada microserviço validar o token no próprio middleware.
 * Três razões contra: a lógica de autenticação seria duplicada e passível de
 * divergir; o API Gateway cacheia o resultado do authorizer, então a validação
 * acontece uma vez por token e não uma vez por requisição; e a requisição não
 * autorizada é barrada **antes** de invocar a Lambda de domínio, o que economiza
 * invocação e mantém a fronteira de autenticação em um lugar só.
 */

import { randomUUID } from "node:crypto";
import { logger } from "../utils/BlissLogger";
import { runWithRequestContext } from "../utils/requestContext";

const MODULE = "Authorizer";

/** Evento de um authorizer do tipo REQUEST. */
export interface AuthorizerEvent {
	type: string;
	methodArn: string;
	headers?: Record<string, string | undefined>;
	queryStringParameters?: Record<string, string | undefined>;
	requestContext?: { requestId?: string; path?: string; httpMethod?: string };
}

/** Identidade resolvida a partir do token. */
export interface AuthorizedPrincipal {
	/** Identificador único de quem chama. Vira o `principalId` da política. */
	principalId: string;
	/**
	 * Dados repassados à Lambda de domínio em `event.requestContext.authorizer`.
	 *
	 * O API Gateway só aceita string, número e booleano aqui — objeto aninhado é
	 * descartado em silêncio, e a Lambda recebe `undefined` sem nenhum aviso.
	 */
	context?: Record<string, string | number | boolean>;
}

/** Valida a credencial. Deve lançar quando inválida. */
export type TokenVerifier = (event: AuthorizerEvent) => Promise<AuthorizedPrincipal>;

export interface PolicyDocument {
	principalId: string;
	policyDocument: {
		Version: "2012-10-17";
		Statement: Array<{ Action: string; Effect: "Allow" | "Deny"; Resource: string }>;
	};
	context?: Record<string, string | number | boolean>;
}

/**
 * Recorta o ARN do método para liberar a API inteira, e não só a rota chamada.
 *
 * O API Gateway cacheia a política por token. Se ela citasse apenas o método
 * atual, a segunda requisição — para outra rota, com o mesmo token — bateria no
 * cache com uma política que não a cobre e receberia 403. Autorizar no nível da
 * API é o comportamento correto quando o cache está ligado.
 */
export function buildResourceArn(methodArn: string | undefined): string {
	/*
	 * `methodArn` ausente é cenário real, não hipótese defensiva: invocação
	 * direta da função, teste pelo console da AWS e o LocalStack em algumas
	 * configurações não o enviam. Sem esta guarda o `split` lançava `TypeError`
	 * — e lançava dentro do caminho de **negação**, que existe justamente para
	 * nunca lançar. O efeito era o oposto do pretendido: em vez de um `Deny`
	 * limpo, o API Gateway recebia 500, e uma credencial ausente passava a
	 * parecer defeito do serviço.
	 *
	 * O curinga sozinho é o que ainda produz uma política válida. Como o efeito
	 * neste caminho é `Deny`, ele não concede nada.
	 */
	if (typeof methodArn !== "string" || methodArn.length === 0) return "*";

	// arn:aws:execute-api:<região>:<conta>:<apiId>/<stage>/<método>/<caminho...>
	const [arnPart, stagePart] = methodArn.split("/", 2);
	if (!arnPart || !stagePart) return methodArn;
	return `${arnPart}/${stagePart}/*/*`;
}

export function allow(principal: AuthorizedPrincipal, methodArn: string): PolicyDocument {
	return {
		principalId: principal.principalId,
		policyDocument: {
			Version: "2012-10-17",
			Statement: [{ Action: "execute-api:Invoke", Effect: "Allow", Resource: buildResourceArn(methodArn) }],
		},
		...(principal.context ? { context: principal.context } : {}),
	};
}

export function deny(methodArn: string): PolicyDocument {
	return {
		principalId: "anonymous",
		policyDocument: {
			Version: "2012-10-17",
			Statement: [{ Action: "execute-api:Invoke", Effect: "Deny", Resource: buildResourceArn(methodArn) }],
		},
	};
}

/**
 * Cria o handler do authorizer.
 *
 * Falha de validação vira política de `Deny`, não exceção. Lançar faz o API
 * Gateway responder **500**, sugerindo defeito no serviço quando o que houve foi
 * uma credencial inválida — e um 500 nessa posição esconde ataque de força bruta
 * no meio do ruído de erro.
 */
export function createAuthorizerHandler(verify: TokenVerifier) {
	return async (event: AuthorizerEvent, context?: { awsRequestId?: string }): Promise<PolicyDocument> => {
		const requestId =
			event.headers?.["x-request-id"] ??
			event.headers?.["X-Request-Id"] ??
			event.requestContext?.requestId ??
			context?.awsRequestId ??
			randomUUID();

		return runWithRequestContext({ requestId, startedAt: Date.now() }, async () => {
			const route = `${event.requestContext?.httpMethod ?? "?"} ${event.requestContext?.path ?? "?"}`;

			try {
				const principal = await verify(event);
				logger.log("info", MODULE, "authorize", "acesso autorizado", {
					principalId: principal.principalId,
					route,
				});
				return allow(principal, event.methodArn);
			} catch (error) {
				// `warn`, não `error`: credencial inválida é o authorizer funcionando,
				// não defeito. Emitir como erro afogaria o alarme de taxa de erro.
				logger.log("warn", MODULE, "authorize", "acesso negado", {
					route,
					reason: error instanceof Error ? error.message : String(error),
				});
				return deny(event.methodArn);
			}
		});
	};
}
