/**
 * @module api/db/schema/enums
 *
 * Enums do Postgres construídos a partir dos literais de `@saude-bliss/contracts`.
 *
 * A ordem importa: os arrays de `contracts` são a fonte, o `pgEnum` é derivado.
 * Se alguém adicionar um status lá e esquecer aqui, o TypeScript reclama — em
 * vez de o banco rejeitar o insert só em produção.
 */

import { REQUEST_EVENT_TYPES, REQUEST_PRIORITIES, REQUEST_STATUSES } from "@saude-bliss/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const requestPriorityEnum = pgEnum("request_priority", REQUEST_PRIORITIES);
export const requestStatusEnum = pgEnum("request_status", REQUEST_STATUSES);
export const requestEventTypeEnum = pgEnum("request_event_type", REQUEST_EVENT_TYPES);
