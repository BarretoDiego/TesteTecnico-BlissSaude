# AWS real. Mesmo HCL — só a flag muda.
env_suffix     = "dev"
use_localstack = false
region         = "us-east-1"

log_level              = "info"
logs_retention_in_days = 7

# max_connections de uma db.t4g.micro é ~87.
# 10 * 1 = 10 conexões, com folga larga para migration e inspeção manual.
reserved_concurrency = 10
db_pool_max          = 1

create_rds_instance = true
