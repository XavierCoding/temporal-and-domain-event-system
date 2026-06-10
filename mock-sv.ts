/**
 * Mock Samvadini server — stands in for both SV WA and SV Outbound services.
 * Logs every inbound request and returns 200 so Temporal activities don't fail.
 *
 * Run: npx tsx mock-sv.ts
 * Listens on :8000 (WA) and :8723 (Outbound)
 */
import http from "http";

function makeHandler(label: string) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = body ? JSON.parse(body) : {};
      const url = req.url ?? "";

      // State endpoints return structured responses
      if (url.includes("/wa_window")) {
        const phone = new URL(url, "http://x").searchParams.get("phone");
        console.log(`[${label}] GET wa_window  phone=${phone}`);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ state: "open", elapsed_hours: 0.5 }));
        return;
      }

      if (url.includes("/demand_in_zone")) {
        const params = new URL(url, "http://x").searchParams;
        console.log(`[${label}] GET demand_in_zone  city=${params.get("city")} job_type=${params.get("job_type")}`);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ has_demand: true }));
        return;
      }

      // Action endpoints — log and ack
      console.log(`[${label}] POST ${url}`);
      if (payload.phone) console.log(`         phone=${payload.phone} template=${payload.template ?? "-"} temperature=${payload.temperature ?? "-"}`);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  };
}

http.createServer(makeHandler("SV-WA  :8000")).listen(8000, () =>
  console.log("Mock SV WA       → http://localhost:8000")
);

http.createServer(makeHandler("OUTBOUND:8723")).listen(8723, () =>
  console.log("Mock SV Outbound → http://localhost:8723")
);

console.log("\nAll /internal/actions/* and /internal/state/* requests will be logged here.\n");
