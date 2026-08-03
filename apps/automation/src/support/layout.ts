/**
 * @module automation/support/layout
 *
 * Verificações de layout que só fazem sentido em tela estreita.
 *
 * Existem porque a classe de defeito móvel não aparece nas asserções comuns: a
 * tela renderiza tudo, os dados estão certos, o teste de fluxo passa — e mesmo
 * assim o cabeçalho está cobrindo o botão de perfil e a página inteira rola para
 * o lado. Só medindo a geometria dá para afirmar o contrário.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export interface OverflowReport {
	scrollWidth: number;
	clientWidth: number;
	/** Quem está estourando, para a mensagem de falha dizer onde olhar. */
	offenders: string[];
}

/**
 * Mede o transbordo horizontal do documento e identifica os culpados.
 *
 * Elementos dentro de um container com rolagem própria (`overflow-x: auto`) são
 * ignorados de propósito: uma tabela larga que rola dentro da própria moldura é
 * a solução, não o defeito. O que não pode é a **página** rolar para o lado.
 */
export async function medirTransbordoHorizontal(page: Page): Promise<OverflowReport> {
	return page.evaluate(() => {
		const doc = document.documentElement;
		const limite = doc.clientWidth;

		const temRolagemPropria = (element: Element): boolean => {
			let current: Element | null = element.parentElement;
			while (current && current !== doc) {
				const overflowX = getComputedStyle(current).overflowX;
				if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") return true;
				current = current.parentElement;
			}
			return false;
		};

		const culpados: Array<{ element: Element; descricao: string }> = [];
		for (const element of Array.from(document.body.querySelectorAll("*"))) {
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			if (temRolagemPropria(element)) continue;

			// Dois sintomas, e o segundo é o que custa a achar. O primeiro é a caixa
			// passar da borda. O segundo é o conteúdo transbordar uma caixa que cabe:
			// um e-mail ou UUID sem ponto de quebra estica o `scrollWidth` sem mexer
			// no `getBoundingClientRect`, então nada aparece fora do lugar — só a
			// página inteira ganha rolagem lateral.
			//
			// 1px de folga nos dois: arredondamento de subpixel em fator de escala
			// fracionário produz 393.33 contra 393 sem nada estar de fato fora.
			const caixaForaDaTela = rect.right > limite + 1 || rect.left < -1;
			const conteudoTransbordando = element.scrollWidth > element.clientWidth + 1;
			if (!caixaForaDaTela && !conteudoTransbordando) continue;

			const testId = element.getAttribute("data-testid");
			culpados.push({
				element,
				descricao:
					`${element.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} ` +
					(caixaForaDaTela
						? `left=${Math.round(rect.left)} right=${Math.round(rect.right)}`
						: `conteúdo de ${element.scrollWidth}px em caixa de ${element.clientWidth}px`),
			});
		}

		// Só os mais profundos: o transbordo sobe por toda a cadeia de ancestrais, e
		// listar `body → div → main → section` antes do `dd` que de fato não quebra
		// enterra a informação útil no meio do ruído.
		const offenders = culpados
			.filter(({ element }) => !culpados.some((outro) => outro.element !== element && element.contains(outro.element)))
			.map(({ descricao }) => descricao);

		return { scrollWidth: doc.scrollWidth, clientWidth: limite, offenders: offenders.slice(0, 8) };
	});
}

/** A página não rola para o lado — a asserção central de qualquer tela móvel. */
export async function esperarSemRolagemHorizontal(page: Page): Promise<void> {
	const report = await medirTransbordoHorizontal(page);

	expect(
		report.scrollWidth,
		`a página rola horizontalmente (${report.scrollWidth}px de conteúdo em ${report.clientWidth}px de tela). ` +
			`Estourando: ${report.offenders.join(" · ") || "nenhum elemento identificado"}`
	).toBeLessThanOrEqual(report.clientWidth + 1);
}

/** O elemento cabe inteiro dentro da viewport — usado nos modais. */
export async function esperarDentroDaViewport(locator: Locator, nome: string): Promise<void> {
	const page = locator.page();
	const box = await locator.boundingBox();
	expect(box, `${nome} deveria estar visível para ser medido`).not.toBeNull();

	const viewport = page.viewportSize();
	expect(viewport, "o project deveria definir uma viewport").not.toBeNull();

	expect(box!.x, `${nome} sai pela borda esquerda`).toBeGreaterThanOrEqual(-1);
	expect(
		box!.x + box!.width,
		`${nome} tem ${Math.round(box!.width)}px numa tela de ${viewport!.width}px`
	).toBeLessThanOrEqual(viewport!.width + 1);
}

/**
 * O elemento recebe o toque — ninguém está por cima dele.
 *
 * Um elemento pode estar `visible` para o Playwright e ainda assim ser
 * intocável: foi o que acontecia com o botão de perfil, coberto pelo menu que
 * transbordava. `elementFromPoint` no centro do alvo é o que a interface faria
 * com o dedo de quem usa.
 */
export async function esperarAlcancavelPeloToque(locator: Locator, nome: string): Promise<void> {
	await expect(locator, `${nome} deveria estar visível`).toBeVisible();

	const alcancavel = await locator.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const alvo = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		return alvo === element || element.contains(alvo);
	});

	expect(alcancavel, `${nome} está visível, mas outro elemento recebe o toque no lugar dele`).toBe(true);
}

/**
 * O container rola horizontalmente por conta própria.
 *
 * É o contrato da tabela em tela estreita: as colunas não cabem, e a saída certa
 * é a moldura rolar — não a página.
 */
export async function esperarRolagemPropria(locator: Locator, nome: string): Promise<void> {
	const rolavel = await locator.evaluate((element) => {
		const container = element.scrollWidth > element.clientWidth ? element : element.parentElement;
		if (!container) return false;
		const overflowX = getComputedStyle(container).overflowX;
		return container.scrollWidth > container.clientWidth && (overflowX === "auto" || overflowX === "scroll");
	});

	expect(rolavel, `${nome} deveria rolar horizontalmente dentro da própria moldura`).toBe(true);
}
