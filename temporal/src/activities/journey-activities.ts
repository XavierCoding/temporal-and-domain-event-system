import { getPool } from "../db/pool.js";
import { logger } from "../logger.js";
import { ActionArgs } from "../schemas/action-args.js";

// ── Config types (shared with workflow via import type) ───────────────────────

export interface ActionCfg {
  action: string;
  template?: string;
  replacements?: string[];
  next_node?: string;
  use_event_data?: boolean;
}

export interface NudgeRung {
  wait_hours: number;
  action_open?: ActionCfg;
  action_closed?: ActionCfg;
  on_exhaust?: ActionCfg;
}

export interface EventTransition {
  next_stage: string;
  action?: string;
  template?: string;
  replacements?: string[];
  next_node?: string;
}

export interface StageConfig {
  on_enter?: ActionCfg;
  min_wait_hours?: number;
  debounce_minutes?: number;
  demand_check_required?: boolean;
  quiet_hours_enabled?: boolean;
  nudge_ladder?: NudgeRung[];
  events?: Record<string, EventTransition>;
}

export interface JourneyConfig {
  client: string;
  stages: string[];
  stages_map: Record<string, StageConfig>;
}

// ── Activities ────────────────────────────────────────────────────────────────

export async function fetchJourneyConfig(client: string): Promise<JourneyConfig> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT config FROM journey_config WHERE client = $1 AND active = TRUE ORDER BY version DESC LIMIT 1",
    [client]
  );
  if (res.rows.length === 0) {
    throw new Error(`No active journey config found for client: ${client}`);
  }
  return res.rows[0].config as JourneyConfig;
}

export async function updateLeadStage(args: ActionArgs): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE leads SET journey_stage = $1, updated_at = NOW() WHERE phone = $2",
    [args.stage, args.phone]
  );
  logger.info({ phone: args.phone, stage: args.stage }, "lead stage updated");
}

export async function markGiveUp(args: ActionArgs): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE leads SET journey_status = 'give_up', give_up_at = NOW() WHERE phone = $1",
    [args.phone]
  );
  logger.info({ phone: args.phone }, "lead marked as give_up");
}

export async function pushToScrm(args: ActionArgs): Promise<void> {
  // Stub: in prod, POST to SCRM service to route to TC pool
  logger.info({ phone: args.phone, stage: args.stage }, "pushToScrm (stub)");
}
