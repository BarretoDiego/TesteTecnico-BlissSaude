/**
 * Helpers do authorizer do API Gateway.
 *
 * Duas decisões daqui não são óbvias e valem teste próprio: o escopo da política
 * precisa cobrir a API inteira por causa do cache, e falha de validação vira
 * `Deny` em vez de exceção — lançar faria o gateway responder 500, sugerindo
 * defeito no serviço quando o que houve foi credencial inválida.
 */

import { allow, buildResourceArn, createAuthorizerHandler, deny } from "../../../src/app/authorizer";

const ARN = "arn:aws:execute-api:us-east-1:000000000000:abc123/local/GET/v1/requests";

const principal = {
	principalId: "daniel@saudebliss.test",
	context: { userId: "u-1", email: "daniel@saudebliss.test", roles: "admin,reviewer" },
};

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		type: "REQUEST",
		methodArn: ARN,
		headers: { authorization: "Bearer token" },
		requestContext: { requestId: "trace-authz", path: "/v1/requests", httpMethod: "GET" },
		...overrides,
	} as never;
}

describe("buildResourceArn", () => {
	it("libera a API inteira, e não apenas o método chamado", () => {
		// A política é cacheada por token. Citando só o método atual, a segunda
		// requisição — outra rota, mesmo token — bateria no cache com uma política
		// que não a cobre e receberia 403.
		expect(buildResourceArn(ARN)).toBe("arn:aws:execute-api:us-east-1:000000000000:abc123/local/*/*");
	});

	it("preserva região, conta, API e stage", () => {
		const resultado = buildResourceArn(ARN);

		// O stage precisa continuar no ARN: liberar `*/*` a partir da raiz daria
		// acesso a outros stages da mesma API.
		expect(resultado).toContain("us-east-1");
		expect(resultado).toContain("abc123");
		expect(resultado).toContain("/local/");
	});

	it.each([
		[
			"outro stage",
			"arn:aws:execute-api:us-east-1:1:api/prod/POST/v1/x",
			"arn:aws:execute-api:us-east-1:1:api/prod/*/*",
		],
		[
			"caminho profundo",
			"arn:aws:execute-api:us-east-1:1:api/dev/GET/a/b/c",
			"arn:aws:execute-api:us-east-1:1:api/dev/*/*",
		],
	])("recorta corretamente com %s", (_caso, entrada, esperado) => {
		expect(buildResourceArn(entrada)).toBe(esperado);
	});

	it("devolve a entrada quando não há stage para recortar", () => {
		// Acontece em invocação direta e em teste de console: sem barra, não há o
		// que recortar. Devolver como veio é melhor do que montar um ARN inválido.
		expect(buildResourceArn("arn-sem-barras")).toBe("arn-sem-barras");
	});

	it("não quebra com string vazia", () => {
		expect(() => buildResourceArn("")).not.toThrow();
	});
});

describe("allow", () => {
	it("produz política de Allow com o principal", () => {
		const politica = allow(principal, ARN);

		expect(politica.principalId).toBe("daniel@saudebliss.test");
		expect(politica.policyDocument.Statement[0]).toMatchObject({ Effect: "Allow", Action: "execute-api:Invoke" });
	});

	it("aplica o escopo recortado ao recurso", () => {
		expect(allow(principal, ARN).policyDocument.Statement[0]!.Resource).toBe(buildResourceArn(ARN));
	});

	it("repassa o contexto para a Lambda de domínio", () => {
		// Chega em `event.requestContext.authorizer` — é o que evita a Lambda
		// revalidar o token que a borda já validou.
		expect(allow(principal, ARN).context).toEqual(principal.context);
	});

	it("omite o contexto quando não há", () => {
		// `context: undefined` no documento faz o API Gateway rejeitar a política.
		expect(allow({ principalId: "x" }, ARN)).not.toHaveProperty("context");
	});

	it("usa a versão de política que o API Gateway espera", () => {
		expect(allow(principal, ARN).policyDocument.Version).toBe("2012-10-17");
	});
});

describe("deny", () => {
	it("produz política de Deny", () => {
		expect(deny(ARN).policyDocument.Statement[0]).toMatchObject({ Effect: "Deny" });
	});

	it("usa um principal anônimo", () => {
		// Não há identidade a atribuir: o token não validou. Inventar um id
		// poluiria o log de acesso com um usuário que não existe.
		expect(deny(ARN).principalId).toBe("anonymous");
	});

	it("não carrega contexto", () => {
		// Contexto num Deny chegaria à Lambda caso a política fosse mal
		// interpretada — melhor não existir.
		expect(deny(ARN)).not.toHaveProperty("context");
	});
});

describe("createAuthorizerHandler", () => {
	it("devolve Allow quando a verificação passa", async () => {
		const handler = createAuthorizerHandler(async () => principal);

		const politica = await handler(makeEvent());

		expect(politica.policyDocument.Statement[0]!.Effect).toBe("Allow");
		expect(politica.principalId).toBe("daniel@saudebliss.test");
	});

	it("devolve Deny em vez de lançar quando a verificação falha", async () => {
		const handler = createAuthorizerHandler(async () => {
			throw new Error("token inválido");
		});

		// Lançar faria o gateway responder 500 — que sugere defeito no serviço e
		// esconde força bruta no meio do ruído de erro.
		const politica = await handler(makeEvent());

		expect(politica.policyDocument.Statement[0]!.Effect).toBe("Deny");
	});

	it("não vaza o motivo da recusa na política", async () => {
		const handler = createAuthorizerHandler(async () => {
			throw new Error("assinatura não confere com a chave kid=abc");
		});

		const politica = await handler(makeEvent());

		expect(JSON.stringify(politica)).not.toContain("kid=abc");
	});

	it("nega quando o evento não traz methodArn", async () => {
		const handler = createAuthorizerHandler(async () => {
			throw new Error("sem credencial");
		});

		// Invocação direta e teste de console não trazem `methodArn`. O caminho de
		// negação não pode estourar justamente onde existe para nunca lançar.
		const politica = await handler(makeEvent({ methodArn: undefined }));

		expect(politica.policyDocument.Statement[0]!.Effect).toBe("Deny");
	});

	it("usa o requestId do header quando o cliente o envia", async () => {
		const capturado: string[] = [];
		const handler = createAuthorizerHandler(async () => {
			const { getRequestId } = await import("../../../src/utils/requestContext");
			capturado.push(getRequestId() ?? "");
			return principal;
		});

		await handler(makeEvent({ headers: { "x-request-id": "trace-do-cliente" } }));

		// O trace do browser precisa sobreviver à passagem pelo authorizer, senão
		// a correlação quebra logo na borda.
		expect(capturado[0]).toBe("trace-do-cliente");
	});

	it("cai para o requestId do API Gateway quando o cliente não envia", async () => {
		const capturado: string[] = [];
		const handler = createAuthorizerHandler(async () => {
			const { getRequestId } = await import("../../../src/utils/requestContext");
			capturado.push(getRequestId() ?? "");
			return principal;
		});

		await handler(makeEvent({ headers: {} }));

		expect(capturado[0]).toBe("trace-authz");
	});

	it("gera um id quando não há nenhuma origem", async () => {
		const capturado: string[] = [];
		const handler = createAuthorizerHandler(async () => {
			const { getRequestId } = await import("../../../src/utils/requestContext");
			capturado.push(getRequestId() ?? "");
			return principal;
		});

		await handler(makeEvent({ headers: {}, requestContext: undefined }));

		// Sem id, a linha de log do authorizer ficaria órfã — impossível de ligar
		// à requisição que a originou.
		expect(capturado[0]).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("aceita a grafia com maiúsculas do header", async () => {
		const capturado: string[] = [];
		const handler = createAuthorizerHandler(async () => {
			const { getRequestId } = await import("../../../src/utils/requestContext");
			capturado.push(getRequestId() ?? "");
			return principal;
		});

		// O API Gateway normaliza headers de forma inconsistente entre integrações.
		await handler(makeEvent({ headers: { "X-Request-Id": "trace-maiusculo" } }));

		expect(capturado[0]).toBe("trace-maiusculo");
	});

	it("usa o requestId da Lambda como última alternativa", async () => {
		const capturado: string[] = [];
		const handler = createAuthorizerHandler(async () => {
			const { getRequestId } = await import("../../../src/utils/requestContext");
			capturado.push(getRequestId() ?? "");
			return principal;
		});

		await handler(makeEvent({ headers: {}, requestContext: undefined }), { awsRequestId: "aws-request-1" });

		expect(capturado[0]).toBe("aws-request-1");
	});
});
