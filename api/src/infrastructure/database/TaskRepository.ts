import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type { Env } from "../../env";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  or,
} from "drizzle-orm";

export type Db = NeonHttpDatabase<typeof schema>;

export function buildDatabase(env: Env): Db {
  const url = env.NEON_DATABASE_URL;
  if (!url || typeof url !== "string" || !url.trim()) {
    throw new Error(
      "NEON_DATABASE_URL is not set. Set it with: wrangler secret put NEON_DATABASE_URL (in the api/ directory)"
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export const tasks = schema.tasks;
export const projects = schema.projects;
export const users = schema.users;
export const tenantMembers = schema.tenantMembers;