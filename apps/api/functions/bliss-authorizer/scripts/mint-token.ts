/**
 * Emite um token de acesso para desenvolvimento e para a suíte de automação.
 *
 * Não é um serviço de autenticação — é utilitário local. Em produção quem emite
 * é o provedor de identidade; aqui o objetivo é ter uma credencial válida para
 * exercitar o authorizer sem depender de nada externo.
 *
 * Uso: pnpm --filter @saude-bliss/bliss-authorizer token [email] [papéis]
 */

import { config } from "dotenv";

config({ path: ["../../.env.local", "../../.env", "../../../../.env"] });

import { SignJWT } from "jose";

async function main(): Promise<void> {
	const email = process.argv[2] ?? "daniel.morais@saudebliss.test";
	const roles = (process.argv[3] ?? "reviewer").split(",");

	const secret = process.env.JWT_SECRET;
	if (!secret) {
		console.error("defina JWT_SECRET no .env para emitir um token");
		process.exit(1);
	}

	const token = await new SignJWT({ email, roles })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(email)
		.setIssuer(process.env.JWT_ISSUER ?? "saude-bliss")
		.setAudience(process.env.JWT_AUDIENCE ?? "saude-bliss-api")
		.setIssuedAt()
		.setExpirationTime(process.env.JWT_TTL ?? "12h")
		.sign(new TextEncoder().encode(secret));

	console.log(token);
}

main().catch((error) => {
	console.error("falha ao emitir token:", error);
	process.exit(1);
});
