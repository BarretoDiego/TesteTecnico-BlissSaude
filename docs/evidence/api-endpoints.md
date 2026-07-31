# Evidência — endpoints

> Capturado em 2026-07-31T07:45:35Z contra `http://localhost:4000/v1`

## `POST /requests` → 201

```http
POST http://localhost:4000/v1/requests
x-request-id: evidencia-1785483935
```
```json
{
    "success": true,
    "data": {
        "id": "5c4712f5-bacb-47be-82ea-4519c7882926",
        "title": "Evid\u00eancia de deploy",
        "description": "Solicita\u00e7\u00e3o criada pelo script de evid\u00eancias para demonstrar o fluxo completo.",
        "priority": "high",
        "status": "open",
        "createdBy": "evidencia@saudebliss.test",
        "reviewedBy": null,
        "reviewedAt": null,
        "createdTraceId": "evidencia-1785483935",
        "createdAt": "2026-07-31T07:45:35.615Z",
        "updatedAt": "2026-07-31T07:45:35.615Z"
    },
    "requestId": "evidencia-1785483935",
    "timestamp": "2026-07-31T07:45:35.622Z",
    "message": "Solicita\u00e7\u00e3o criada com sucesso"
}
```

## `GET /requests/{id}` → 200
```json
{
    "success": true,
    "data": {
        "id": "5c4712f5-bacb-47be-82ea-4519c7882926",
        "title": "Evid\u00eancia de deploy",
        "description": "Solicita\u00e7\u00e3o criada pelo script de evid\u00eancias para demonstrar o fluxo completo.",
        "priority": "high",
        "status": "open",
        "createdBy": "evidencia@saudebliss.test",
        "reviewedBy": null,
        "reviewedAt": null,
        "createdTraceId": "evidencia-1785483935",
        "createdAt": "2026-07-31T07:45:35.615Z",
        "updatedAt": "2026-07-31T07:45:35.615Z",
        "events": [
            {
                "id": "0f5c670f-e9f8-45fa-b5a3-2ae9e6371632",
                "requestId": "5c4712f5-bacb-47be-82ea-4519c7882926",
                "type": "created",
                "fromStatus": null,
                "toStatus": "open",
                "actor": "evidencia@saudebliss.test",
                "traceId": "evidencia-1785483935",
                "createdAt": "2026-07-31T07:45:35.615Z"
            }
        ]
    },
    "requestId": "a178cb4b-8d4a-4547-9564-56def69995b6",
    "timestamp": "2026-07-31T07:45:35.670Z"
}
```

## `GET /requests/{id}` inexistente → 404
```json
{
    "success": false,
    "error": {
        "code": "REQUEST_NOT_FOUND",
        "message": "Solicita\u00e7\u00e3o n\u00e3o encontrada",
        "details": {
            "id": "00000000-0000-4000-8000-999999999999"
        }
    },
    "requestId": "a504f4d9-99fe-4c63-9695-14e5b0dd9f9e",
    "timestamp": "2026-07-31T07:45:35.696Z"
}
```

## `GET /requests?createdBy=&status=` → 200
```json
{
    "success": true,
    "data": {
        "items": [
            {
                "id": "5c4712f5-bacb-47be-82ea-4519c7882926",
                "title": "Evidência de deploy",
                "description": "Solicitação criada pelo script de evidências para demonstrar o fluxo completo.",
                "priority": "high",
                "status": "open",
                "createdBy": "evidencia@saudebliss.test",
                "reviewedBy": null,
                "reviewedAt": null,
                "createdTraceId": "evidencia-1785483935",
                "createdAt": "2026-07-31T07:45:35.615Z",
                "updatedAt": "2026-07-31T07:45:35.615Z"
            }
        ],
        "pagination": {
            "page": 1,
            "pageSize": 20,
            "total": 1,
            "totalPages": 1
        }
    },
    "requestId": "560193de-7a4a-4593-9d0d-2ea237883696",
    "timestamp": "2026-07-31T07:45:35.724Z"
}
```

## `POST /requests` inválido → 400
```json
{
    "success": false,
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Os dados enviados s\u00e3o inv\u00e1lidos",
        "details": [
            {
                "field": "title",
                "message": "T\u00edtulo deve ter ao menos 3 caracteres"
            },
            {
                "field": "description",
                "message": "Informe a descri\u00e7\u00e3o da solicita\u00e7\u00e3o"
            },
            {
                "field": "priority",
                "message": "Invalid enum value. Expected 'low' | 'medium' | 'high' | 'critical', received 'urgente'"
            },
            {
                "field": "createdBy",
                "message": "Informe o identificador do solicitante"
            }
        ]
    },
    "requestId": "10659394-f32d-4c02-8f9c-f9cb05585325",
    "timestamp": "2026-07-31T07:45:35.739Z"
}
```

## `PATCH /reviews/{id}` conferida duas vezes → 200 e 409
```json
{
    "success": true,
    "data": {
        "id": "5c4712f5-bacb-47be-82ea-4519c7882926",
        "title": "Evid\u00eancia de deploy",
        "description": "Solicita\u00e7\u00e3o criada pelo script de evid\u00eancias para demonstrar o fluxo completo.",
        "priority": "high",
        "status": "reviewed",
        "createdBy": "evidencia@saudebliss.test",
        "reviewedBy": "daniel.morais@saudebliss.test",
        "reviewedAt": "2026-07-31T07:45:35.766Z",
        "createdTraceId": "evidencia-1785483935",
        "createdAt": "2026-07-31T07:45:35.615Z",
        "updatedAt": "2026-07-31T07:45:35.766Z"
    },
    "requestId": "c502dfec-2df2-4b81-82c0-4b65c18f3874",
    "timestamp": "2026-07-31T07:45:35.770Z",
    "message": "Confer\u00eancia registrada com sucesso"
}
{
    "success": false,
    "error": {
        "code": "REQUEST_ALREADY_REVIEWED",
        "message": "Esta solicita\u00e7\u00e3o j\u00e1 foi conferida",
        "details": {
            "id": "5c4712f5-bacb-47be-82ea-4519c7882926",
            "status": "reviewed",
            "reviewedBy": "daniel.morais@saudebliss.test"
        }
    },
    "requestId": "1e9a81d0-86bc-4c8b-9420-684fdf4d4c0d",
    "timestamp": "2026-07-31T07:45:35.792Z"
}
```

## Rastreabilidade — `evidencia-1785483935`

O id enviado pelo cliente volta no envelope, no header `x-request-id` e é
persistido em `requests.created_trace_id`:

```
evidencia-1785483935|reviewed|high|Evidência de deploy
```
