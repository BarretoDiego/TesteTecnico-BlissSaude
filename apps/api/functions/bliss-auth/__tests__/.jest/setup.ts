/**
 * Setup dos testes.
 *
 * Roda antes do carregamento dos módulos, o que é obrigatório: o `logger`
 * compartilhado lê o nível no carregamento, então definir a variável dentro de
 * um teste não teria efeito.
 *
 * O nível fica em `error` porque o conteúdo dos logs é verificado nos testes do
 * `BlissLogger`, que espionam o console diretamente. Deixar `debug` aqui só
 * enterraria a saída do Jest.
 */

process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "error";
process.env.BLISS_ENV = "local";
