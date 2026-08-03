# ADR 0002 — Serverless Framework e Terraform

> Última atualização: 2026-08-03

**Status:** aceito · substitui a decisão original de 2026-07-31

## Contexto

O desafio determina **Serverless Framework** como stack. O padrão da casa
(`bv-backend`, `eyecareoticas-backend`, `eyecare-services`) usa **Terraform** em
`devops/iac/`. Adotar só um dos dois descumpriria o enunciado ou o padrão do time.

### As duas ferramentas competem?

Parcialmente, e a distinção sustenta a decisão.

**Onde competem:** ambas criam Lambda e API Gateway. Nessa faixa são
alternativas de verdade, e **não podem** governar os mesmos recursos ao mesmo
tempo — cada uma mantém o próprio estado (CloudFormation aqui, arquivo de state
ali), e dois donos do mesmo recurso produzem drift e remoção acidental.

**Onde não competem:** o centro de gravidade é diferente. O Serverless Framework
abstrai a *aplicação* — funções e eventos — e entrega emulação local e convenção
de empacotamento que o Terraform não tem. O Terraform descreve *qualquer
recurso*, e é onde a infraestrutura durável (VPC, RDS, DNS, IAM fino) cabe sem
contorção.

## Decisão

**Duas trilhas completas de deploy, cada uma capaz de subir o sistema inteiro
sozinha, em stages separados.**

|             | Terraform            | Serverless Framework       |
| ----------- | -------------------- | -------------------------- |
| Comando     | `pnpm deploy:local`  | `pnpm deploy:sls`          |
| Stage       | `local`              | `sls`                      |
| Estado      | arquivo de state     | stack de CloudFormation    |
| Declaração  | `infra/terraform/`   | `apps/api/serverless.yml`  |
| Topologia   | uma API, 4 Lambdas   | idêntica                   |

As duas coexistem: os nomes de recurso levam o stage, então subir uma não derruba
a outra. `pnpm urls` mostra as duas URLs lado a lado, e o mesmo
`scripts/localstack/smoke.sh` — 17 asserções — roda contra qualquer uma,
resolvendo o alvo por variável de ambiente.

**O que não se deve fazer:** apontar as duas para o mesmo stage. É a única
configuração que reintroduz o problema de dois donos.

### Por que um `serverless.yml` agregado

Cada `functions/*/serverless.yml` é um serviço próprio do Serverless Framework, e
cada serviço cria a **própria** API Gateway — quatro serviços dariam quatro URLs
base, e o backoffice consome uma. O arquivo em `apps/api/serverless.yml` declara
as quatro funções atrás de uma API só, reproduzindo a topologia do Terraform. Os
arquivos por serviço seguem existindo para `sls offline` e `sls package`.

### Artefato compartilhado

As duas trilhas consomem o **mesmo** `dist/function.zip`, produzido pelo esbuild.
Não há segundo bundler, então o que o Serverless publica é byte a byte o que o
Terraform publica.

Uma sutileza custou tempo e vale registrar: o Serverless usa o **nome do
arquivo** como chave no S3. Os quatro bundles se chamam `function.zip`, então
apontá-los direto faz os quatro subirem para a mesma chave — o último vence e
todas as funções passam a rodar o mesmo código. O sintoma é péssimo de ler: a
função de solicitações responde com log do authorizer.
`scripts/serverless/deploy.sh` copia cada bundle para `.artifacts/<serviço>.zip`
antes do deploy.

## Duplicação assumida

A tabela de rotas existe no router do Fastify, no mapa `routes` do módulo
Terraform e nos `serverless.yml`. É duplicação real: o API Gateway precisa de um
recurso por caminho para autorizar por método, o Fastify precisa das rotas para
despachar.

`pnpm check:routes` compara e falha o CI na divergência. Reconhecer a duplicação
e cercá-la com verificação automatizada lê melhor do que fingir que ela não
existe — e previne o modo de falha real: alguém acrescenta uma rota, os testes
passam (usam o app diretamente) e só o deploy revela o 403.

## Limitações do LocalStack nesta trilha

Encontradas ao construir, todas contornadas ou documentadas:

- **`AWS::Lambda::Version` falha.** O `PublishVersion` do LocalStack acusa
  divergência de `CodeSHA256` mesmo com o artefato idêntico. Resolvido com
  `versionFunctions: false`, o que também aproxima as duas trilhas — o Terraform
  também não publica versões.
- **`sls remove` aborta no ECR**, que o Community não implementa. O script remove
  o stack direto pelo CloudFormation.
- **Recriar um stack com o mesmo nome depois de apagado não funciona.** O
  LocalStack o deixa em `REVIEW_IN_PROGRESS` e o deploy seguinte falha.
  Reimplantar sobre um stack saudável funciona normalmente; recriar do zero exige
  `pnpm reset`. É limitação do emulador, não da configuração — em AWS real o
  ciclo remove/recria é rotineiro.
- **Custom authorizers não são executados pela borda**, como já acontecia na
  trilha do Terraform. O smoke detecta e valida o authorizer por invocação
  direta, com o mesmo contrato de evento `REQUEST`.

## Consequências

O enunciado é cumprido literalmente: `sls deploy` provisiona a API e devolve uma
URL que responde. O padrão da casa também: o Terraform segue sendo a trilha
principal, e é a que `pnpm start` usa.

O custo é manter duas declarações da mesma topologia. É deliberado, e o
`check:routes` cobre a parte que mais divergiria.
