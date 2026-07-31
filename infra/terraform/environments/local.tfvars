# LocalStack — o alvo padrão de desenvolvimento.
env_suffix          = "local"
use_localstack      = true
localstack_endpoint = "http://localhost:4568"

# O LocalStack v3 valida o runtime contra a lista da AWS da época dele, que para
# em `nodejs20.x`. O bundle é gerado com target node20 justamente para rodar nos
# dois — código para node20 executa em nodejs22.x sem ajuste.
lambda_runtime = "nodejs20.x"

log_level              = "debug"
logs_retention_in_days = 1

# Concorrência e pool baixos: o Postgres local não precisa de mais, e manter os
# mesmos números do ambiente real deixa a aritmética visível.
reserved_concurrency = 5
db_pool_max          = 1

# `false` por padrão: a emulação de RDS é feature Pro do LocalStack, e sem ela o
# projeto sobe igual apontando para o Postgres do compose. É o que permite ao
# avaliador rodar o deploy completo sem licença.
#
# Com LOCALSTACK_AUTH_TOKEN configurado e a imagem `-pro` no compose, ligue para
# exercitar o RDS emulado de verdade.
create_rds_instance = false
rds_fallback_host   = "postgres"
