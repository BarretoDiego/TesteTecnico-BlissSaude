# ADR 0002 — Serverless Framework e Terraform

> Última atualização: 2026-07-31

**Status:** aceito

## Contexto

O desafio determina **Serverless Framework** como stack. O padrão da casa
(`bv-backend`, `eyecareoticas-backend`, `eyecare-services`) usa **Terraform** em
`devops/iac/`. Adotar só um dos dois descumpriria o enunciado ou o padrão do time.

## Decisão

Os dois, com divisão dura de responsabilidade:

**O Serverless Framework nunca toca a nuvem.** É emulador local (`serverless-offline`)
e packager (`sls package`). **Terraform é a única coisa que cria ou muda recurso.**

Os dois consomem **o mesmo** `dist/function.zip`, produzido pelo esbuild
(`package.artifact` no `serverless.yml`). Não há segundo bundler, então o que roda
em `sls offline` é byte a byte o que sobe na Lambda.

Roda em `serverless@3`: a v4 exige conta e `SERVERLESS_ACCESS_KEY`, o que quebraria
um deploy local offline. O `serverless.yml` usa sintaxe compatível com as duas.

## Duplicação assumida

A tabela de rotas existe no router do Fastify, no mapa `routes` do módulo Terraform
e — só o prefixo — no `serverless.yml`. É duplicação real: o API Gateway precisa de
um recurso por caminho para autorizar por método, o Fastify precisa das rotas para
despachar.

`pnpm check:routes` compara os três e falha o CI na divergência. Reconhecer a
duplicação e cercá-la com verificação automatizada lê melhor do que fingir que ela
não existe — e previne o modo de falha real: alguém acrescenta uma rota, os testes
passam (usam o app diretamente) e só o deploy revela o 403.
