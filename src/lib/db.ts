import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sql } from "./sql";

/**
 * Prisma shares the `pg` pool from `./sql` rather than opening its own.
 *
 * Two pools to the same database doubled the connection footprint for no
 * benefit — and the pool built here had no `max` (so it silently took pg's
 * default of 10 *on top of* the other pool's 20) and, more seriously, no
 * `error` listener. An idle client erroring on a pool with no listener is an
 * unhandled 'error' event, which takes the process down. That was fixed for
 * the raw-SQL pool and missed here, because the duplication hid it.
 *
 * Sharing also means the timeouts and `PG_POOL_MAX` sizing in `./sql` apply to
 * Prisma queries too, so there's one number to tune for concurrency.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(sql) });

globalForPrisma.prisma = prisma;

export default prisma;
