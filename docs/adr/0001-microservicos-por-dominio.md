# ADR 0001 — Microserviços por domínio

> Última atualização: 2026-07-31

**Status:** aceito

## Contexto

O escopo inicial é uma API de gestão de solicitações com três endpoints. Um único
serviço monolítico daria conta dele.

## Decisão

Quatro microserviços, um por domínio, uma Lambda cada:

| Serviço            | Prefixo        | Responsabilidade                              |
| ------------------ | -------------- | --------------------------------------------- |
| `bliss-auth`       | `/v1/auth`     | emissão, renovação e revogação de sessões     |
| `bliss-authorizer` | —              | validação do token na borda do API Gateway    |
| `bliss-requests`   | `/v1/requests` | abertura e consulta de solicitações           |
| `bliss-reviews`    | `/v1/reviews`  | conferência operacional e trilha de auditoria |

## Justificativa

A separação não é por gosto arquitetural — cada par tem perfil operacional oposto:

- **Abertura vs conferência.** Os atores são outros (solicitante vs conferente), o
  perfil de carga é outro (fluxo contínuo vs rajadas na conferência diária) e a
  criticidade é outra. Uma fila de conferência pesada não pode consumir a
  concorrência de quem está abrindo solicitação.
- **Autenticação vs autorização.** `bliss-auth` é chamado uma vez por sessão e faz
  trabalho **caro de propósito** — derivar a senha leva ~100ms, e é esse custo que
  torna força bruta impraticável. `bliss-authorizer` entra no caminho de toda
  requisição e precisa ser barato. Dimensionar os dois juntos obrigaria a escolher
  entre login lento e authorizer caro.

## Consequências

- Cada domínio escala, faz deploy e é observado como unidade.
- O banco é compartilhado (uma tabela, uma definição), mas as **queries** não: cada
  serviço tem seu repositório com apenas as operações do seu domínio.
- O custo é a fronteira: comunicação entre domínios passaria por EventBridge, não
  por chamada direta. Nenhum fluxo atual precisa disso, então o caminho está
  preparado no core mas não exercitado.
