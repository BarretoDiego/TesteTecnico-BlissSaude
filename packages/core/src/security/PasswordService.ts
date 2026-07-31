/**
 * @module core/security/PasswordService
 *
 * Derivação e verificação de senha com `scrypt`.
 *
 * ## Por que `scrypt` da biblioteca padrão
 *
 * `argon2` seria a primeira escolha, mas é binding nativo — o esbuild não o
 * empacota e a Lambda quebraria no cold start. `bcryptjs` é JavaScript puro e
 * funciona, mas é ordens de grandeza mais lento que uma implementação nativa, o
 * que na prática **reduz** o custo do ataque: o defensor precisa baixar os
 * parâmetros para caber no timeout, e quem ataca usa hardware dedicado de
 * qualquer forma.
 *
 * `crypto.scrypt` é nativo do Node, dispensa dependência, é um KDF de senha
 * recomendado pelo OWASP e resiste a hardware dedicado por ser memory-hard.
 * Nada aqui é criptografia inventada: é o primitivo usado do jeito documentado —
 * salt aleatório por senha, comparação em tempo constante e parâmetros gravados
 * junto ao hash.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * `promisify` perde a sobrecarga que aceita opções — sem a anotação, o
 * TypeScript só enxerga a assinatura de três argumentos e recusa o `maxmem`,
 * que aqui é obrigatório.
 */
const scrypt = promisify(scryptCallback) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: ScryptOptions
) => Promise<Buffer>;

/**
 * Custo da derivação.
 *
 * `N = 2^15` leva ~100ms em hardware de Lambda: caro o bastante para tornar
 * força bruta impraticável, barato o bastante para não estourar o timeout do
 * login. Precisa vir acompanhado de `maxmem` — o default do Node é 32MB e
 * `N=32768, r=8` exige ~33MB, então sem isso a derivação falha com
 * `memory limit exceeded`.
 */
const PARAMS = { N: 32_768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function maxmemFor(params: { N: number; r: number }): number {
	return 128 * params.N * params.r * 2;
}

/** `scrypt$N$r$p$salt$hash` — números em decimal, binários em base64url. */
function serialize(salt: Buffer, derived: Buffer, params: typeof PARAMS): string {
	return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

interface ParsedHash {
	params: { N: number; r: number; p: number };
	salt: Buffer;
	derived: Buffer;
}

function parse(stored: string): ParsedHash {
	const [scheme, n, r, p, salt, derived] = stored.split("$");

	if (scheme !== "scrypt" || !n || !r || !p || !salt || !derived) {
		throw new Error("hash de senha em formato desconhecido");
	}

	return {
		params: { N: Number(n), r: Number(r), p: Number(p) },
		salt: Buffer.from(salt, "base64url"),
		derived: Buffer.from(derived, "base64url"),
	};
}

export class PasswordService {
	/** Deriva o hash de uma senha nova, com salt aleatório. */
	async hash(password: string): Promise<string> {
		const salt = randomBytes(SALT_LENGTH);
		const derived = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: maxmemFor(PARAMS) });
		return serialize(salt, derived, PARAMS);
	}

	/**
	 * Verifica a senha contra o hash armazenado.
	 *
	 * Usa os parâmetros gravados no próprio hash, não os atuais: é o que permite
	 * endurecer o custo no futuro sem invalidar as senhas já cadastradas.
	 *
	 * A comparação é `timingSafeEqual`. Um `===` vazaria, pelo tempo de resposta,
	 * quantos bytes iniciais coincidem — o suficiente para recuperar o hash byte
	 * a byte com requisições repetidas.
	 */
	async verify(password: string, stored: string): Promise<boolean> {
		let parsed: ParsedHash;
		try {
			parsed = parse(stored);
		} catch {
			return false;
		}

		// `KEY_LENGTH` constante, e **não** `parsed.derived.length`: derivar no
		// tamanho que veio do hash armazenado deixa quem controla a linha do banco
		// escolher quantos bytes precisam bater. Um hash truncado para poucos bytes
		// passaria a verificar com probabilidade alta, e a checagem de tamanho
		// abaixo nunca dispararia — os dois lados encolheriam juntos.
		const derived = await scrypt(password, parsed.salt, KEY_LENGTH, {
			...parsed.params,
			maxmem: maxmemFor(parsed.params),
		});

		// `timingSafeEqual` lança quando os tamanhos diferem, o que já é
		// divergência — trata-se como senha errada.
		if (derived.length !== parsed.derived.length) return false;
		return timingSafeEqual(derived, parsed.derived);
	}
}

export const passwordService = new PasswordService();
