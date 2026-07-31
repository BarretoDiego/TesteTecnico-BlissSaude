/**
 * @module api/common/BaseRepository
 */

import { WithLogging } from "./WithLogging";

/**
 * Base da camada de acesso a dados.
 *
 * Regra do repositório: subclasses são o **único** lugar que importa `db` ou
 * operadores do Drizzle. Quando uma query vaza para o service, testar a regra de
 * negócio passa a exigir um banco de verdade.
 */
export abstract class BaseRepository extends WithLogging {}
