# =============================================================================
# Uma Lambda por microserviço.
#
# Cria função, papel IAM com o mínimo necessário e o log group **explícito**.
# =============================================================================

locals {
  function_name = "${var.project_name}-${var.service_name}-${var.env_suffix}"
}

resource "aws_iam_role" "lambda" {
  name = "${local.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Política mínima: escrever log, ler o próprio segredo e publicar métrica.
# Sem `Action: "*"` nem `Resource: "*"` onde é possível ser específico — o
# curinga aqui concederia mais do que a função precisa.
data "aws_iam_policy_document" "lambda" {
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  statement {
    sid       = "Metrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"] # PutMetricData não aceita recurso específico
  }

  dynamic "statement" {
    for_each = var.secret_arn == "" ? [] : [var.secret_arn]

    content {
      sid       = "ReadDatabaseSecret"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      resources = [statement.value]
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.function_name}-policy"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

# Log group declarado, não deixado para a Lambda criar sozinha: assim a
# retenção é aplicada desde a primeira invocação. Criado implicitamente, ele
# nasce com retenção infinita e a conta cresce em silêncio.
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.logs_retention_in_days
}

resource "aws_lambda_function" "this" {
  function_name = local.function_name
  role          = aws_iam_role.lambda.arn
  handler       = var.handler
  runtime       = var.runtime
  timeout       = var.timeout
  memory_size   = var.memory_size

  # O zip real produzido por `build.js`. Um módulo que
  # zipa `src/app.ts` cru via `archive_file` — o que empacota TypeScript que a
  # Lambda não sabe executar.
  filename = var.lambda_package_file

  # Redeploy quando o conteúdo muda. Sem isso, `terraform apply` após um build
  # novo não atualiza a função: o caminho do arquivo continua igual.
  source_code_hash = filebase64sha256(var.lambda_package_file)

  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = var.environment_variables
  }

  # Sem a dependência explícita, a função pode ser criada antes do log group e
  # a AWS o cria sozinha, ignorando a retenção configurada acima.
  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.lambda]
}
