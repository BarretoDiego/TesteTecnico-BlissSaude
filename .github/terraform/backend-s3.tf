# =============================================================================
# Backend remoto — **só no pipeline**.
#
# Este arquivo não vive em `infra/terraform/`: o job de deploy o copia para lá
# antes do `init`. É o que permite os dois modos coexistirem sem uma flag.
#
#   - na máquina e no ensaio com LocalStack, o arquivo não existe e o Terraform
#     usa o backend local, que é o que faz `pnpm deploy:local` funcionar sem
#     nenhuma credencial de nuvem;
#   - no pipeline, o arquivo aparece e o estado passa a viver no S3, com trava —
#     que é o mínimo para dois deploys concorrentes não corromperem o estado.
#
# A configuração é **parcial** de propósito: bucket, chave e região chegam por
# `-backend-config` no `init`, vindos de `vars` do repositório. Fixá-los aqui
# amarraria o repositório a uma conta específica.
# =============================================================================

terraform {
  backend "s3" {}
}
