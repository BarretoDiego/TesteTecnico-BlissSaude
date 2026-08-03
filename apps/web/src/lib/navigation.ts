"use client";

/**
 * @module web/lib/navigation
 *
 * Atualização da query string pela History API nativa.
 *
 * **Por que não `router.replace`.** As telas de listagem e conferência são
 * pré-renderizadas estaticamente e leem o estado por `useSearchParams`. Nessa
 * combinação, `router.replace(pathname + "?" + params)` — mesma rota, query
 * diferente — é descartado no build de produção: o roteador reescreve o
 * endereço com a URL **anterior** e nada muda. Filtro, paginação e "limpar"
 * simplesmente não funcionavam fora do servidor de desenvolvimento, onde o mesmo
 * código navega normalmente. Foi a suíte Playwright rodando contra o build do CI
 * que expôs a diferença.
 *
 * `pushState` e `replaceState` nativos são o caminho documentado para esse caso
 * e se integram ao roteador: `usePathname` e `useSearchParams` reagem à mudança,
 * que é o que faz a tela recarregar os dados. De quebra, some a ida ao servidor
 * por RSC a cada clique de filtro — que aqui nunca serviu para nada, já que os
 * dados vêm da API pelo browser.
 */

/**
 * Substitui a query string da URL atual, sem criar entrada no histórico.
 *
 * Sem histórico de propósito: cada tecla de filtro virando um passo do botão
 * voltar obrigaria a pessoa a voltar dez vezes para sair da tela.
 */
export function replaceSearchParams(pathname: string, params: URLSearchParams): void {
	const query = params.toString();
	window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
}
