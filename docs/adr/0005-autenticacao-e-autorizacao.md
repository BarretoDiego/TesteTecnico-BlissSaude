# ADR 0005 — Autenticação e autorização

> Última atualização: 2026-07-31

**Status:** aceito

## Decisão

`bliss-auth` **autentica** (troca credencial por token); `bliss-authorizer`
**autoriza** (valida o token na borda do API Gateway). Ver ADR 0001 para o porquê da
separação.

## Senha: `crypto.scrypt`

`argon2` seria a primeira escolha, mas é binding nativo — o esbuild não empacota e a
Lambda quebra no cold start. `bcryptjs` é JavaScript puro e funciona, mas é ordens de
grandeza mais lento que uma implementação nativa, o que na prática **reduz** o custo
do ataque: o defensor precisa baixar os parâmetros para caber no timeout, e quem
ataca usa hardware dedicado de qualquer forma.

`crypto.scrypt` é nativo do Node, dispensa dependência, é recomendado pelo OWASP e
resiste a hardware dedicado por ser memory-hard. Salt por senha, comparação em tempo
constante, e os parâmetros gravados **dentro** do hash — é o que permite endurecer o
custo depois sem invalidar as senhas existentes.

## Refresh token opaco, não JWT

Sessão precisa ser **revogável**, e JWT só deixa de valer quando expira. O refresh é
aleatório de 256 bits, guardado como SHA-256 — vazamento de banco não vira sequestro
de sessão.

Rotaciona a cada uso, em transação. Reapresentar um token já revogado derruba
**todas** as sessões do usuário: é a detecção de reuso da OAuth 2.0 Security BCP —
um token revogado voltando significa que vazou ou que há duas cópias em uso.

## Sem oráculo de enumeração

- E-mail inexistente e senha errada respondem o **mesmo** 401.
- A senha é derivada contra um hash descartável mesmo sem usuário, para igualar o
  tempo de resposta — sem isso um responde em ~1ms e o outro em ~100ms, e a
  diferença é medível.
- Conta desativada só vira 403 **depois** de a senha conferir.

## Detalhes do authorizer

- Token inválido devolve política de **`Deny`**, nunca lança. Lançar faz o API
  Gateway responder 500, que lê como defeito do serviço e esconde força bruta no
  ruído de erro.
- A política autoriza a **API inteira**, não o método chamado: ela é cacheada por
  token, e uma política restrita ao método atual daria 403 na requisição seguinte
  para outra rota.
- `algorithms: ["HS256"]` fixado. Sem isso um token forjado com `alg: none` passa.
- O `context` carrega só escalares — o API Gateway descarta objeto aninhado em
  silêncio, e a Lambda de domínio receberia `undefined` sem aviso.

## Limitação conhecida

O **LocalStack Community não executa custom authorizers**, embora
`aws apigateway get-method` confirme `authorizationType: CUSTOM` com o `authorizerId`
correto. O smoke detecta se a borda aplica autorização e, quando não aplica, valida
o authorizer por invocação direta com o mesmo contrato de evento `REQUEST`.
