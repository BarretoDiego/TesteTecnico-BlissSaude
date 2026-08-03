# ADR 0004 — RDS e pool de conexões em Lambda

> Última atualização: 2026-07-31

**Status:** aceito

## Contexto

A persistência do projeto é **RDS**. Em arquitetura serverless a escolha não é
óbvia: um banco de documentos gerenciado dispensa VPC e gerenciamento de conexão,
que é justamente onde o relacional cobra caro. Este ADR registra por que o
relacional ainda assim serve melhor a este domínio, e como o custo foi contido.

## Por que relacional serve a este domínio

Argumentando pelo domínio, não por preferência:

- **Schema estável e fechado.** Os campos da solicitação são conhecidos e fixos.
  Não há variação por tipo de ticket que justificasse documento livre.
- **Consulta por atributo com ordenação.** `?createdBy=` e `?status=`, combináveis,
  com ordenação por data. Filtros ad-hoc combináveis são caros de modelar em chave
  composta e triviais em SQL — foi este o critério que decidiu.
- **Escrita transacional em duas tabelas.** Mudança de status e evento de auditoria
  precisam acontecer juntas. Sem transação, uma falha entre as duas escritas deixa
  a solicitação sem trilha — exatamente o que a conferência depende de encontrar.
- **Integridade referencial.** A FK com cascade impede evento órfão.

## Contraponto honesto

DynamoDB seria superior em escala de escrita imprevisível e em custo ocioso, e não
exige VPC nem gerenciamento de conexão em Lambda. RDS traz um custo real que precisa
ser administrado — o próximo tópico.

## Pool de conexões

O ponto crítico: **cada container quente mantém o próprio pool.** Com `max: 10` e 50
containers concorrentes seriam 500 conexões contra uma `db.t4g.micro`, que aceita
~87. O banco recusa e a API cai inteira, não só o excedente.

A aritmética que precisa valer:

```
max_connections >= reserved_concurrency × DB_POOL_MAX + folga_operacional
```

Configuração adotada:

- `DB_POOL_MAX = 1` (`packages/database/src/client.ts`)
- `reserved_concurrency` por serviço no Terraform — teto **duro** de invocações
- `idleTimeoutMillis: 30_000` — mantém o socket entre invocações próximas
- `connectionTimeoutMillis: 5_000` — falha rápido em vez de pendurar a Lambda até
  o timeout dela, pagando duração cheia por uma conexão que não vai acontecer
- `callbackWaitsForEmptyEventLoop: false` — sem isso a Lambda espera o socket
  ocioso fechar antes de retornar, destruindo o pool a cada request
- **nunca** `pool.end()` por requisição

**RDS Proxy é a resposta de produção**: multiplexa conexões e remove o acoplamento
entre concorrência de Lambda e limite do banco. Não foi adotado no ambiente local
porque o suporte do LocalStack é parcial; em AWS real entra na frente do pool.
