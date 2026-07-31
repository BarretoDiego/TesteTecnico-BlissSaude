/**
 * Authorizer do API Gateway.
 *
 * O foco não é "aceita token bom, recusa token ruim" — é o conjunto de detalhes
 * que fazem um authorizer falhar de forma insegura ou confusa: recusar sem virar
 * 500, escopo de política compatível com o cache, e rejeição de algoritmo
 * forjado.
 */

import { SignJWT } from "jose";
import { authorize, lambdaHandler, tokenService } from "../../src/app";
import { TokenService } from "../../src/services/TokenService";

const SECRET = "segredo-de-teste-com-tamanho-suficiente";
const ISSUER = "saude-bliss";
const AUDIENCE = "saude-bliss-api";
const METHOD_ARN = "arn:aws:execute-api:us-east-1:000000000000:abc123/local/GET/v1/requests";

beforeEach(() => {
	process.env.JWT_SECRET = SECRET;
	process.env.JWT_ISSUER = ISSUER;
	process.env.JWT_AUDIENCE = AUDIENCE;
	tokenService.resetCache();
});

async function mint(overrides: Partial<Record<string, unknown>> = {}, options: { secret?: string } = {}) {
	const builder = new SignJWT({ email: "daniel@saudebliss.test", roles: ["reviewer"], ...overrides })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject((overrides.sub as string) ?? "daniel@saudebliss.test")
		.setIssuer((overrides.iss as string) ?? ISSUER)
		.setAudience((overrides.aud as string) ?? AUDIENCE)
		.setIssuedAt()
		.setExpirationTime((overrides.exp as string) ?? "1h");

	return builder.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

function makeEvent(token?: string) {
	return {
		type: "REQUEST",
		methodArn: METHOD_ARN,
		headers: token ? { authorization: `Bearer ${token}` } : {},
		requestContext: { requestId: "trace-authz", path: "/v1/requests", httpMethod: "GET" },
	};
}

describe("authorize — token válido", () => {
	it("resolve o principal a partir da claim sub", async () => {
		const principal = await authorize(makeEvent(await mint()));

		expect(principal.principalId).toBe("daniel@saudebliss.test");
	});

	it("repassa identidade e papéis no contexto", async () => {
		const principal = await authorize(makeEvent(await mint()));

		expect(principal.context).toEqual({
			userId: "daniel@saudebliss.test",
			email: "daniel@saudebliss.test",
			roles: "reviewer",
		});
	});

	it("serializa papéis como string, não array", async () => {
		const principal = await authorize(makeEvent(await mint({ roles: ["reviewer", "admin"] })));

		// O API Gateway descarta valor não escalar no contexto em silêncio, e a
		// Lambda de domínio receberia `undefined` sem nenhum aviso.
		expect(principal.context?.roles).toBe("reviewer,admin");
		expect(Array.isArray(principal.context?.roles)).toBe(false);
	});
});

describe("authorize — recusas", () => {
	it.each([
		["header ausente", undefined],
		["token vazio", ""],
	])("recusa quando o %s", async (_case, token) => {
		await expect(authorize(makeEvent(token))).rejects.toThrow();
	});

	it("recusa header sem o esquema Bearer", async () => {
		const event = { ...makeEvent(), headers: { authorization: await mint() } };

		// Aceitar o valor cru deixaria passar credencial sem esquema, que é como
		// ela vaza em log de proxy mal configurado.
		await expect(authorize(event)).rejects.toThrow(/Bearer/);
	});

	it("recusa token assinado com outra chave", async () => {
		const token = await mint({}, { secret: "chave-completamente-diferente-e-longa" });

		await expect(authorize(makeEvent(token))).rejects.toThrow();
	});

	it("recusa token expirado", async () => {
		const token = await mint({ exp: "-1h" });

		await expect(authorize(makeEvent(token))).rejects.toThrow();
	});

	it("recusa token de outro emissor", async () => {
		const token = await mint({ iss: "outro-sistema" });

		await expect(authorize(makeEvent(token))).rejects.toThrow();
	});

	it("recusa token destinado a outra audiência", async () => {
		const token = await mint({ aud: "outra-api" });

		await expect(authorize(makeEvent(token))).rejects.toThrow();
	});

	it("recusa token sem assinatura (alg none)", async () => {
		// Confusão de algoritmo: sem fixar `algorithms: ["HS256"]` na verificação,
		// um token com `alg: none` passaria. A defesa é declarar o esperado em vez
		// de confiar no cabeçalho do token.
		const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
		const payload = Buffer.from(JSON.stringify({ sub: "invasor", iss: ISSUER, aud: AUDIENCE })).toString("base64url");

		await expect(authorize(makeEvent(`${header}.${payload}.`))).rejects.toThrow();
	});
});

describe("lambdaHandler — documento de política", () => {
	it("devolve Allow para token válido", async () => {
		const policy = await lambdaHandler(makeEvent(await mint()));

		expect(policy.principalId).toBe("daniel@saudebliss.test");
		expect(policy.policyDocument.Statement[0]).toMatchObject({ Effect: "Allow", Action: "execute-api:Invoke" });
	});

	it("devolve Deny em vez de lançar quando o token é inválido", async () => {
		// Lançar faria o API Gateway responder 500, sugerindo defeito no serviço
		// quando o que houve foi credencial inválida — e esconderia força bruta no
		// meio do ruído de erro.
		const policy = await lambdaHandler(makeEvent("token-invalido"));

		expect(policy.principalId).toBe("anonymous");
		expect(policy.policyDocument.Statement[0]?.Effect).toBe("Deny");
	});

	it("autoriza a API inteira, não apenas o método chamado", async () => {
		const policy = await lambdaHandler(makeEvent(await mint()));

		// O API Gateway cacheia a política por token. Restrita ao método atual, a
		// requisição seguinte para outra rota bateria no cache com uma política
		// que não a cobre e receberia 403.
		expect(policy.policyDocument.Statement[0]?.Resource).toBe(
			"arn:aws:execute-api:us-east-1:000000000000:abc123/local/*/*"
		);
	});

	it("repassa o contexto à Lambda de domínio quando autoriza", async () => {
		const policy = await lambdaHandler(makeEvent(await mint()));

		expect(policy.context).toMatchObject({ userId: "daniel@saudebliss.test" });
	});

	it("não repassa contexto quando nega", async () => {
		const policy = await lambdaHandler(makeEvent("token-invalido"));

		expect(policy.context).toBeUndefined();
	});
});

describe("TokenService.extractToken", () => {
	const service = new TokenService();

	it.each(["authorization", "Authorization"])("aceita a grafia %s do header", (header) => {
		// O API Gateway normaliza headers de forma inconsistente entre integrações.
		expect(service.extractToken({ [header]: "Bearer abc" })).toBe("abc");
	});

	it.each([
		["Basic YWRtaW46YWRtaW4=", /Bearer/],
		["Bearer", /Bearer/],
		["", /ausente/],
	])("rejeita o header %p", (value, expected) => {
		expect(() => service.extractToken({ authorization: value })).toThrow(expected);
	});
});

describe("TokenService — configuração ausente", () => {
	it("falha alto quando nenhuma origem de chave está definida", async () => {
		delete process.env.JWT_SECRET;
		delete process.env.JWT_SECRET_ID;
		const service = new TokenService();

		await expect(service.verify("qualquer.coisa.aqui")).rejects.toThrow(/JWT_SECRET/);
	});
});

describe("authorize — claims incompletas", () => {
	it("resolve o contexto quando o token não traz e-mail nem papéis", async () => {
		// O API Gateway descarta valor `undefined` do contexto em silêncio, e a
		// Lambda de domínio receberia campo ausente sem nenhum aviso. Os defaults
		// garantem que a forma do contexto não dependa do conteúdo do token.
		const token = await new SignJWT({})
			.setProtectedHeader({ alg: "HS256" })
			.setSubject("sem-claims@saudebliss.test")
			.setIssuer(ISSUER)
			.setAudience(AUDIENCE)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(SECRET));

		const principal = await authorize(makeEvent(token));

		expect(principal.context).toEqual({
			userId: "sem-claims@saudebliss.test",
			email: "",
			roles: "",
		});
	});

	it("recusa evento sem headers", async () => {
		// `headers` ausente acontece de verdade em invocação direta e em teste de
		// console — não pode virar `TypeError`, que o API Gateway traduziria em
		// 500 em vez de 401.
		const { headers: _ignorado, ...semHeaders } = makeEvent();

		await expect(authorize(semHeaders as Parameters<typeof authorize>[0])).rejects.toThrow();
	});
});

describe("TokenService — chave via Secrets Manager", () => {
	it("busca a chave quando só JWT_SECRET_ID está definida", async () => {
		delete process.env.JWT_SECRET;
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";

		const secrets = {
			getSecretJson: jest.fn().mockResolvedValue({ signingKey: SECRET }),
			clearCache: jest.fn(),
		};
		const service = new TokenService(secrets as never);

		const claims = await service.verify(await mint());

		expect(claims.sub).toBe("daniel@saudebliss.test");
		expect(secrets.getSecretJson).toHaveBeenCalledWith("/local/saude-bliss/auth/jwt");
	});

	it("busca o segredo uma vez só entre invocações do mesmo container", async () => {
		delete process.env.JWT_SECRET;
		process.env.JWT_SECRET_ID = "/local/saude-bliss/auth/jwt";

		const secrets = {
			getSecretJson: jest.fn().mockResolvedValue({ signingKey: SECRET }),
			clearCache: jest.fn(),
		};
		const service = new TokenService(secrets as never);

		await service.verify(await mint());
		await service.verify(await mint());

		// Sem o cache, toda requisição autenticada pagaria ~50ms de Secrets
		// Manager — no caminho crítico de cada chamada à API.
		expect(secrets.getSecretJson).toHaveBeenCalledTimes(1);
	});
});

describe("TokenService — bordas do contrato do token", () => {
	it("recusa chamada sem headers", () => {
		// Assinatura com default: chamar sem argumento é legítimo em código de
		// teste e invocação direta, e precisa recusar em vez de estourar.
		expect(() => new TokenService().extractToken()).toThrow(/Authorization/);
	});

	it("recusa token sem a claim sub", async () => {
		// `sub` vira o `principalId` da política. Sem ela o API Gateway receberia
		// `undefined` como identificador e a autorização passaria a valer para
		// "todo mundo" no cache do authorizer.
		const semSub = await new SignJWT({ email: "x@y.test" })
			.setProtectedHeader({ alg: "HS256" })
			.setIssuer(ISSUER)
			.setAudience(AUDIENCE)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(SECRET));

		await expect(new TokenService().verify(semSub)).rejects.toThrow(/sub/);
	});
});
