# Pipeline — CI e deploy

> Última atualização: 2026-08-03

Dois workflows: [`ci.yml`](../../../.github/workflows/ci.yml) verifica, [`deploy.yml`](../../../.github/workflows/deploy.yml) implanta. O segundo chama o primeiro em vez de repeti-lo.

## Princípios

**Paralelo por padrão.** Uma dependência entre jobs só existe quando é real. O `plano` precede as matrizes porque é ele quem descobre quais pacotes existem; `plano → aplicar → smoke` é serial porque cada um consome o resultado do anterior. Todo o resto dispara junto.

**Matriz derivada do disco.** `matriz.mjs` procura `jest.config.js` para achar suítes e `build.js` para achar microserviços. Um domínio novo entra no pipeline sem ninguém editar YAML — e, mais importante, sem ninguém **esquecer** de editar YAML, que é como um serviço passa meses sem cobertura de CI.

**Relatório é entregável.** Cada job escreve um fragmento de markdown; o job final junta tudo num documento com tabela de situação, detalhe por etapa e log recolhido. Sai no resumo da execução, num comentário único do PR (editado a cada push, não empilhado) e num artefato de 30 dias.

**Falhar sem esconder.** Os passos usam `continue-on-error` para que o relatório seja escrito **antes** do `exit 1`. Vermelho sem relatório é o pior dos dois mundos: você sabe que quebrou e não sabe onde.

## CI

| Job                 | O que responde                                                    | Depende de |
| ------------------- | ----------------------------------------------------------------- | ---------- |
| `plano`             | quais suítes e serviços existem neste commit                      | —          |
| `formato`           | o repositório está no formato do Prettier                         | —          |
| `tipos`             | `tsc --noEmit` limpo em todos os pacotes (`--parallel`)           | —          |
| `rotas`             | router, Terraform e `serverless.yml` declaram as mesmas rotas     | —          |
| `testes` (matriz)   | uma suíte por job, com cobertura comparada à meta do próprio Jest | `plano`    |
| `empacotar`(matriz) | um zip por microserviço, com tamanho e sha256                     | `plano`    |
| `terraform`         | HCL válido e formatado                                            | —          |
| `web`               | ESLint e `next build` do backoffice                               | —          |
| `automacao`         | a pilha sobe e a conferência funciona ponta a ponta               | —          |
| `ensaio`            | o sistema **implanta** — Terraform contra LocalStack + smoke      | —          |
| `relatorio`         | consolida tudo e falha se algo falhou                             | todos      |

`relatorio` é o job para marcar como obrigatório na proteção de branch: um nome só, que não precisa ser atualizado quando um job novo aparece.

### O ensaio de deploy é opt-in

Provisiona o sistema inteiro no LocalStack com o mesmo HCL que vai para a AWS. Leva minutos e depende de Docker dentro do runner, então não roda em todo pull request. Para ligar:

- etiqueta `ensaio-de-deploy` no pull request;
- `workflow_dispatch` (vem ligado);
- chamada a partir do `deploy.yml`.

O que ele **não** cobre: o authorizer aplicado na borda. O API Gateway do LocalStack Community não executa custom authorizers — o smoke detecta isso e valida o authorizer por invocação direta, em vez de fingir que passou.

## Deploy

```
contexto ─┬─ verificação (o CI inteiro)  ─┐
          └─ empacotar (um job/serviço) ──┴─ plano ─ [aprovação] ─ aplicar ─ pós-deploy ─ relatório
```

Disparos: push em `main` implanta `dev`; `stage` e `prod` só por `workflow_dispatch`. Promoção é ato deliberado — merge não deve implantar produção por efeito colateral.

O `plano` roda **antes** da aprovação, porque é o plano que a pessoa precisa ler para decidir. O `aplicar` consome o plano salvo como artefato, e não um recalculado depois do aceite: aplicar algo diferente do que foi revisado é o modo de falha que o portão existe para evitar.

O relatório do plano separa criação de destruição e destaca o que remove recurso com estado. Recriação de `aws_api_gateway_deployment` não conta como perigosa — ela acontece a cada mudança de rota por definição, e um aviso que aparece sempre deixa de ser lido.

### Configuração necessária

Sem isto, o `deploy.yml` **não falha**: publica um relatório dizendo o que falta e encerra.

| Onde                | Nome                     | Para quê                                                              |
| ------------------- | ------------------------ | --------------------------------------------------------------------- |
| Secret              | `AWS_ROLE_ARN`           | role assumida por OIDC — sem chave de longa duração                   |
| Secret              | `DB_PASSWORD`            | `TF_VAR_db_password`                                                  |
| Secret              | `JWT_SIGNING_KEY`        | `TF_VAR_jwt_signing_key`, e a chave que o smoke usa para emitir token |
| Secret (opcional)   | `DATABASE_MIGRATION_URL` | caminho até o banco para rodar as migrations                          |
| Variable            | `TF_BACKEND_BUCKET`      | bucket do estado do Terraform                                         |
| Variable (opcional) | `TF_BACKEND_TABLE`       | tabela DynamoDB de trava                                              |
| Variable (opcional) | `AWS_REGION`             | padrão `us-east-1`                                                    |
| Environment         | `dev`, `stage`, `prod`   | onde vive a regra de aprovação                                        |

O estado do Terraform vive no S3 **só no pipeline**: `.github/terraform/backend-s3.tf` é copiado para `infra/terraform/` antes do `init`. Na máquina o arquivo não existe e o backend é local, que é o que faz `pnpm deploy:local` funcionar sem credencial de nuvem nenhuma.

### Migrations: a lacuna conhecida

O RDS é provisionado com `publicly_accessible = false`, que é o certo. Consequência: o runner do GitHub está fora da VPC e não alcança o banco. O job aceita `DATABASE_MIGRATION_URL` (túnel ou bastion) e, na ausência dele, marca a etapa como **pulada** com o aviso de que pode haver código novo rodando contra schema antigo.

Marcar como verde seria mais confortável e mais errado. O caminho definitivo — uma Lambda de migração dentro da VPC — ainda não existe neste repositório.

## Como estender

**Domínio novo:** nada a fazer. `apps/api/functions/<serviço>/` com `build.js` e `jest.config.js` entra sozinho nas duas matrizes.

**Verificação nova:** um job com o par `continue-on-error` + `fragmento.mjs`, e o `id` na lista de `needs` do `relatorio`. Os quatro jobs estáticos (`formato`, `tipos`, `rotas`, `terraform`) são o molde.

**Relatório com dado estruturado:** um script em `.github/scripts/` que leia o JSON da ferramenta e chame `publicar()` de `lib/relatorio.mjs`. `resumo-testes.mjs` é o exemplo mais completo — inclusive por ler as metas de cobertura do `jest.config.js` do pacote em vez de repeti-las.
