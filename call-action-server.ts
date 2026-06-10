/**
 * callAction server — single HTTP endpoint Temporal activities call to perform actions.
 *
 * POST /callAction
 * Body: { action, phone, client?, template?, replacements?, nextNode?, ... }
 *
 * Run: npx tsx call-action-server.ts
 * Expose via ngrok: ngrok http 4000
 */
import http from "http";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionPayload {
  action: string;
  phone: string;
  client?: string;
  template?: string;
  replacements?: string[];
  nextNode?: string;
  eventData?: Record<string, unknown>;
  paused?: boolean;
  temperature?: string;
  elapsedHours?: number;
  city?: string;
  jobType?: string;
  stage?: string;
}

// ── Action handlers ───────────────────────────────────────────────────────────
// Each handler receives the full payload and performs the real action.
// Replace the console.log stubs with real API calls as needed.

const handlers: Record<string, (p: ActionPayload) => Promise<void>> = {
  send_wa_template: async (p) => {
    console.log(`[WA TEMPLATE] phone=${p.phone} template=${p.template ?? "journey_update"}`);
    if (p.replacements?.length) {
      p.replacements.forEach((r, i) => console.log(`  {{${i + 1}}} = ${r}`));
    }
    // TODO: POST to Gupshup / WhatsApp Business API
    // await gupshupSendTemplate(p.phone, p.template ?? "journey_update", p.replacements ?? []);
  },

  send_wa_message: async (p) => {
    const message = p.replacements?.[0] ?? "(no message)";
    console.log(`[WA MESSAGE]  phone=${p.phone}`);
    console.log(`  message = ${message}`);
    // TODO: POST to Gupshup / WA free-form message API
    // await gupshupSendMessage(p.phone, message);
  },

  trigger_voice_call: async (p) => {
    console.log(`[VOICE CALL]  phone=${p.phone} client=${p.client ?? "-"}`);
    // TODO: POST to outbound call service
  },

  trigger_samvadini_call: async (p) => {
    console.log(`[SAMVADINI]   phone=${p.phone} client=${p.client ?? "-"}`);
    // TODO: POST to Samvadini outbound service
  },

  assign_tc: async (p) => {
    console.log(`[ASSIGN TC]   phone=${p.phone}`);
    // TODO: POST to TC assignment service
  },

  cancel_pending_callbacks: async (p) => {
    console.log(`[CANCEL CB]   phone=${p.phone}`);
    // TODO: cancel all scheduled callbacks for this phone
  },

  cancel_all_nudges: async (p) => {
    console.log(`[CANCEL NUDGE] phone=${p.phone}`);
    // TODO: cancel pending nudge jobs
  },

  advance_langgraph_state: async (p) => {
    console.log(`[LANGGRAPH]   phone=${p.phone} nextNode=${p.nextNode ?? "-"}`);
    // TODO: POST to LangGraph state machine service
  },

  set_journey_paused: async (p) => {
    console.log(`[PAUSE]       phone=${p.phone} paused=${p.paused}`);
    // TODO: update pause flag in DB / downstream service
  },

  push_to_scrm: async (p) => {
    console.log(`[SCRM]        phone=${p.phone} stage=${p.stage ?? "-"}`);
    // TODO: push to SCRM / TC routing pool
  },

  update_lead_stage: async (p) => {
    console.log(`[LEAD STAGE]  phone=${p.phone} stage=${p.stage ?? "-"}`);
    // TODO: update lead stage in DB
  },
};

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url ?? "";

  // ── GET /waWindowState?phone=... ────────────────────────────────────────────
  if (req.method === "GET" && url.startsWith("/waWindowState")) {
    const phone = new URL(url, "http://x").searchParams.get("phone");
    console.log(`[WA WINDOW]   GET phone=${phone}`);
    // TODO: query real WA session state
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ state: "open", elapsed_hours: 0.5 }));
    return;
  }

  // ── GET /demandInZone?city=...&job_type=... ─────────────────────────────────
  if (req.method === "GET" && url.startsWith("/demandInZone")) {
    const params = new URL(url, "http://x").searchParams;
    console.log(`[DEMAND]      GET city=${params.get("city")} job_type=${params.get("job_type")}`);
    // TODO: query real demand data
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ has_demand: true }));
    return;
  }

  if (req.method !== "POST" || url !== "/callAction") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /callAction" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let payload: ActionPayload;
    try {
      payload = JSON.parse(body) as ActionPayload;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!payload.action || !payload.phone) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields: action, phone" }));
      return;
    }

    const handler = handlers[payload.action];
    if (!handler) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown action: "${payload.action}"` }));
      return;
    }

    try {
      await handler(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, action: payload.action, phone: payload.phone }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] action=${payload.action} phone=${payload.phone}`, message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\ncallAction server → http://localhost:${PORT}/callAction`);
  console.log("Expose via ngrok:   ngrok http " + PORT);
  console.log("\nSupported actions:");
  Object.keys(handlers).forEach((a) => console.log(`  • ${a}`));
  console.log();
});
