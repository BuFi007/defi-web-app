import { PrismaClient } from "@prisma/client";

// Singleton Prisma client for the Kawaii gate (Prisma Postgres / db.prisma.io).
// Reuse across hot-reloads in dev to avoid connection exhaustion.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
