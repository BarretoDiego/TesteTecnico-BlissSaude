/**
 * Setup dos testes do backoffice.
 *
 * `crypto.randomUUID` não existe no jsdom do Node 22, e o interceptor o usa para
 * gerar o `x-request-id` de cada requisição. Sem este preenchimento toda chamada
 * quebraria por um detalhe do simulador, e não por um defeito do código.
 */

import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Origem previsível: os testes afirmam a URL montada pelo cliente HTTP.
process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.teste/v1";
process.env.API_BASE_URL = "http://api.teste/v1";
