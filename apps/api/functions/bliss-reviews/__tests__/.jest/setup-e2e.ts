/**
 * Setup adicional dos testes e2e.
 *
 * Carrega o `.env` para obter a `DATABASE_URL`. Roda depois do setup comum, que
 * já fixou o nível de log.
 */

import { config } from "dotenv";

config({ path: ["../../.env.local", "../../.env"] });
