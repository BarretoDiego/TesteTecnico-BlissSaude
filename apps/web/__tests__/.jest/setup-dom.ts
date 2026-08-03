/**
 * Matchers de DOM do Testing Library.
 *
 * Separado do `setupFiles` porque precisa do ambiente jsdom já montado — em
 * `setupFiles` o `expect` global ainda não existe.
 */

import "@testing-library/jest-dom";
