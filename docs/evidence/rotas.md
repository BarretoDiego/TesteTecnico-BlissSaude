# Evidência — paridade de rotas

Cada rota é declarada no router do Fastify, no mapa `routes` do Terraform e —
só o prefixo — no `serverless.yml`. Este verificador compara os três.

```
✓ bliss-requests: /requests (4 rotas)
    GET /
    GET /health
    GET /{id}
    POST /
✓ bliss-reviews: /reviews (3 rotas)
    GET /health
    GET /{id}/timeline
    PATCH /{id}
✓ bliss-auth: /auth (5 rotas)
    GET /health
    GET /me
    POST /login
    POST /logout
    POST /refresh

✓ rotas em paridade entre o router, o Terraform e o serverless.yml
```
