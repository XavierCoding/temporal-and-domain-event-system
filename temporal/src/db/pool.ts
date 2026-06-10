import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: config.DATABASE_URL });
  }
  return _pool;
}
