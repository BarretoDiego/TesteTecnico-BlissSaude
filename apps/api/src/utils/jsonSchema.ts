/**
 * @module api/utils/jsonSchema
 *
 * Ponte entre Zod e o JSON Schema que o Fastify e o Swagger consomem.
 *
 * O tipo de retorno é deliberadamente truncado para `JsonSchema`. O tipo real do
 * `zod-to-json-schema` é uma união recursiva profunda e, quando embutido em um
 * objeto de rota, faz o `tsc` estourar a heap tentando expandi-lo — falha
 * observada neste projeto, não hipótese. Nada se perde: o Fastify valida esses
 * objetos em runtime contra o próprio dialeto de JSON Schema, então a precisão
 * de tipo aqui não compraria segurança nenhuma.
 */

import type { ZodTypeAny } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

export type JsonSchema = Record<string, unknown>;

/**
 * Referência estreitada da biblioteca.
 *
 * A assinatura original é genérica sobre o schema de entrada e reconstrói a
 * árvore inteira no tipo de retorno — é ela que dispara o TS2589. Estreitar aqui,
 * uma vez, resolve para todos os chamadores.
 */
const convert = zodToJsonSchema as unknown as (schema: unknown, options?: unknown) => JsonSchema;

/** Converte um schema Zod em JSON Schema no dialeto OpenAPI 3. */
export function toJsonSchema(schema: ZodTypeAny): JsonSchema {
	return convert(schema, { target: "openApi3" });
}
