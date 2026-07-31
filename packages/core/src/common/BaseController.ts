/**
 * @module api/common/BaseController
 */

import { WithLogging } from "./WithLogging";

/**
 * Base dos controllers.
 *
 * Deliberadamente vazia além do logging: controllers devem permanecer finos.
 * Qualquer helper adicionado aqui vira convite para lógica de negócio migrar
 * para a camada errada.
 */
export abstract class BaseController extends WithLogging {}
