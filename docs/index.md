# Documentação

> Última atualização: 2026-07-31

Ponto de entrada. A tabela abaixo mapeia **o que você quer fazer** para o arquivo.

## Como navegar

| Quero…                                     | Vá para                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| entender o projeto e rodá-lo               | [`README.md`](../README.md)                                          |
| escrever código seguindo o padrão          | [`CLAUDE.md`](../CLAUDE.md)                                          |
| saber por que há quatro microserviços      | [ADR 0001](adr/0001-microservicos-por-dominio.md)                    |
| saber por que Serverless **e** Terraform   | [ADR 0002](adr/0002-serverless-framework-vs-terraform.md)            |
| entender a rastreabilidade por `requestId` | [ADR 0003](adr/0003-requestid-traceability.md)                       |
| a justificativa de RDS e o pool em Lambda  | [ADR 0004](adr/0004-rds-e-pool-de-conexoes.md)                       |
| como funcionam autenticação e autorização  | [ADR 0005](adr/0005-autenticacao-e-autorizacao.md)                   |
| adicionar uma rota nova                    | [`standards/backend/rotas.md`](standards/backend/rotas.md)           |
| entender a estratégia de testes            | [`standards/testing/estrategia.md`](standards/testing/estrategia.md) |
| ver evidências de execução                 | [`evidence/`](evidence/)                                             |

## Serviços

| Serviço            | Prefixo        | Responsabilidade                           |
| ------------------ | -------------- | ------------------------------------------ |
| `bliss-auth`       | `/v1/auth`     | emissão, renovação e revogação de sessões  |
| `bliss-authorizer` | —              | validação do token na borda do API Gateway |
| `bliss-requests`   | `/v1/requests` | abertura e consulta de solicitações        |
| `bliss-reviews`    | `/v1/reviews`  | conferência e trilha de auditoria          |

## Pacotes compartilhados

| Pacote                   | Conteúdo                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `@saude-bliss/contracts` | enums, schemas Zod, envelope — fonte única da verdade             |
| `@saude-bliss/core`      | factory de app, logging, erros, contexto, config, integrações AWS |
| `@saude-bliss/database`  | schema Drizzle, pool, migrations, seed, mappers                   |
| `@saude-bliss/testing`   | factories e duplos das suítes                                     |
