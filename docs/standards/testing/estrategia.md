# Estratégia de testes

> Última atualização: 2026-08-03

## Camadas

| Camada        | Onde                     | O que exercita                      | Custo              |
| ------------- | ------------------------ | ----------------------------------- | ------------------ |
| `unit`        | `__tests__/unit/`        | tudo mockado, sem I/O               | ~1s                |
| `integration` | `__tests__/integration/` | `app.inject()`, repositório mockado | ~1s                |
| `contract`    | `__tests__/contract/`    | snapshot do `zodToJsonSchema`       | ~1s                |
| `e2e`         | `__tests__/e2e/`         | Postgres real com migrations        | precisa do compose |

```bash
pnpm test                                                   # as oito suítes
pnpm test:api                                               # só os microserviços
pnpm test:packages                                          # só os compartilhados
pnpm test:web                                               # só o backoffice

pnpm --filter @saude-bliss/bliss-requests test              # uma suíte inteira
pnpm --filter @saude-bliss/bliss-requests test:unit         # só uma camada
SKIP_E2E=1 pnpm --filter @saude-bliss/bliss-requests test   # pula e2e
```

A camada `e2e` exige o Postgres do compose (`pnpm infra:up`) com as migrations
aplicadas (`pnpm db:migrate`). Sem banco ela falha; `SKIP_E2E=1` a remove da
execução.

## Onde os testes moram

Junto do código que testam — oito suítes, uma por pacote:

| Suíte                       | Onde                                    |
| --------------------------- | --------------------------------------- |
| os quatro microserviços     | `apps/api/functions/bliss-*/__tests__/` |
| runtime compartilhado       | `packages/core/__tests__/`              |
| contratos (enums, schemas)  | `packages/contracts/__tests__/`         |
| persistência (env, mappers) | `packages/database/__tests__/`          |
| backoffice                  | `apps/web/__tests__/`                   |

Os pacotes compartilhados têm suíte própria porque uma regressão ali quebra todos
os serviços de uma vez e precisa ser pega no pacote, não no consumidor. Factories
e duplos vêm de `@saude-bliss/testing` — uma mudança de schema atualiza um lugar em
vez de divergir por serviço.

O fluxo pelo browser fica fora dessa contagem: é a suíte Playwright em
`apps/automation/`, que roda contra o sistema implantado (`pnpm test:e2e`).

## A suíte de browser

81 cenários em quatro _projects_, divididos por **o que** verificam — e não por
onde rodam:

| Pasta                | Projects                         | O que exercita                                                                           |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `tests/smoke`        | desktop                          | o ambiente de pé: API responde, login carrega, credencial inválida é recusada            |
| `tests/backoffice`   | desktop                          | navegação pelo menu, sessão (guarda de rota, recarga, logout) e perfil                   |
| `tests/solicitacoes` | desktop                          | abertura, listagem com filtros e paginação **pelos controles**, detalhe e trilha         |
| `tests/conferencia`  | desktop                          | a conferência diária, divergências e rastreabilidade por `requestId`                     |
| `tests/mobile`       | `mobile-chrome`, `mobile-safari` | os fluxos críticos por toque, e a geometria: transbordo, alvo coberto, modal na viewport |

A divisão é deliberada. Rodar a suíte inteira nos quatro projects reexecutaria
regra de negócio — que não muda com a largura da tela — ao dobro do custo.
`tests/mobile/` cobre a classe de defeito que **nenhuma** asserção de conteúdo
enxerga: a tela renderiza, os dados estão certos, o fluxo passa, e mesmo assim o
menu cobre o botão de perfil e a página rola de lado.

Essas medições ficam em `src/support/layout.ts` — transbordo horizontal com o
culpado nomeado na mensagem de falha, `elementFromPoint` para provar que o alvo
recebe o toque, e a caixa do modal contra a viewport.

Dois pontos que valem repetir por terem custado depuração:

- **Esperar a consulta certa, não o fim do carregamento.** Ao navegar entre
  filtros ou páginas, a tabela anterior segue na tela: `data-query` diz qual
  consulta os dados exibidos representam. E a espera precisa vir **depois** da
  URL mudar — no instante do clique os dois ainda batem, pela consulta antiga.
- **Reenviar o login enquanto a tela ainda for a de login.** Um clique que chega
  antes da hidratação encontra o botão pintado e sem handler; nada acontece e
  nenhum erro aparece. Como todo teste passa pelo login, era falha intermitente
  na suíte inteira.

## Convenções

- Nome em **PT-BR** descrevendo comportamento: `it("retorna 404 quando a solicitação não existe")`.
- Um comentário quando o teste previne um modo de falha específico — o _porquê_ do
  teste é a informação que se perde primeiro.
- `it.each` para tabela de casos; nada de `for` dentro de um `it`.

## Cobertura

**95% nos quatro critérios** — statements, branches, funções e linhas — em todos
os pacotes, sem exceção por diretório. É o que o `coverageThreshold` de cada
`jest.config.js` declara, e o CI falha abaixo disso. Na prática as oito suítes
fecham em 100%.

O limite vale igual para branches porque é justamente o `catch`, o `??` e o `?.`
que só rodam no dia ruim. Cobri-los não é perseguir métrica: é garantir que o
tratamento de falha ainda funciona quando ninguém está olhando.

Onde o caminho real não alcança o ramo, o teste **injeta** em vez de dispensar:

| Ramo                           | Como                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| resposta impossível do driver  | duplo do Drizzle pelo construtor (`new Repository(dbPromise)`) |
| código que só roda no servidor | suíte própria com `@jest-environment node`                     |
| leitura de arquivo do ambiente | `existsSync` mockado — sem isso a cobertura oscila por máquina |

Exclusões: `app.ts`, `router/index.ts`, barrels `index.ts` — composição de framework
não tem lógica para cobrir e incluí-la só dilui a métrica.

## Duas suítes que valem além da cobertura

**`traceability.integration.test.ts`** afirma que um único `requestId` chega ao
header, ao envelope, aos logs e à coluna persistida — inclusive em 400, 404, 500 e
rota inexistente. O modo de falha que previne: cada camada gerar o próprio id, de
forma que os logs parecem corretos até alguém tentar correlacionar um incidente.

**`reviews.e2e.test.ts`** dispara duas conferências **concorrentes** da mesma
solicitação e afirma que exatamente uma vence e exatamente um evento é gravado. É o
compare-and-set no `where` do `UPDATE`; com repositório mockado isso seria apenas
uma suposição sobre a query.
