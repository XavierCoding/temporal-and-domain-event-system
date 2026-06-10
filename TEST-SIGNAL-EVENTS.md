# test-signal.ts — Event Reference

Direct Temporal workflow testing tool. Bypasses RabbitMQ/domain-event-system — useful for testing the worker in isolation.

## Commands

```bash
# Start a new journey
npx tsx test-signal.ts start  <phone> [client=swiggy]

# Send an event to an existing workflow
npx tsx test-signal.ts signal <phone> <event_type>

# Check workflow status
npx tsx test-signal.ts status <phone>
```

**Workflow ID** is always `journey-<phone>` (e.g. `journey-+919999999999`).

**Temporal UI**: http://localhost:8233

---

## All Event Types

### Journey Progression Events

These events advance the rider through onboarding stages. They are only acted on when the current stage's `events` map contains that event type.

| Event | Stage(s) | Effect |
|-------|----------|--------|
| `location_shared` | D1_location | → O1_app_download; sends app link template |
| `app_downloaded` | O1_app_download | → O2_si; advances LangGraph state |
| `si_filed` | O2_si | → O3_payment |
| `payment_done` | O3_payment | → O4_activation |
| `activated` | O4_activation | → O5_first_order |
| `fod` | O5_first_order | → completed (first order done) |
| `got_better_job` | O5_first_order | → completed (rider dropped out) |

### Document Events (Debounced in O2_si)

O2_si has a 2-minute debounce window. Sending multiple doc events in quick succession will not trigger multiple messages — only the last event after a 2-minute quiet period is acted on.

| Event | Stage(s) | Effect |
|-------|----------|--------|
| `doc_uploaded` | O2_si | Resets debounce window; processed after quiet period |
| `doc_rejected` | O2_si | Resets debounce window; processed after quiet period |

> **Note:** `doc_uploaded` / `doc_rejected` are defined in the EventType enum and can be signalled, but the seed config maps `si_filed` as the final progression event for O2_si. Use these to simulate rapid event bursts when testing debounce behavior.

### Terminal Events

These immediately stop the workflow — no further nudges are sent, pending callbacks are cancelled, and the lead is marked `give_up`.

| Event | Meaning |
|-------|---------|
| `not_interested` | Rider explicitly opts out |
| `no_smartphone` | Rider has no smartphone |
| `blocker_unresolvable` | Onboarding blocked with no fix possible |
| `tc_assigned` | TC (Team Coordinator) has taken over — pause all automated engagement |

Terminal events work at **any stage** regardless of the stage's `events` config. They interrupt debounce windows immediately.

### Control Events

| Event | Effect |
|-------|--------|
| `restart_journey` | Resumes a paused workflow (used after TC assignment). Not queued — handled directly by the signal handler. |

### Informational / Future Events

These are defined in the `EventType` enum but are not currently wired to stage transitions in the seed config. They can be signalled and will be queued but will have no effect until a stage config maps them.

| Event | Description |
|-------|-------------|
| `app_link_shared` | App download link was sent to the rider |
| `ob_done` | Onboarding marked complete externally |
| `vacancy_found` | A job vacancy was found in the rider's zone |
| `no_vacancy` | No vacancy found during demand check |
| `stage_progressed` | Generic stage progression signal |
| `demand_no_orders` | No orders available in zone |

---

## Quick Test Scenarios

### Happy path (full journey)
```bash
npx tsx test-signal.ts start  +919999999999 swiggy
npx tsx test-signal.ts signal +919999999999 location_shared
npx tsx test-signal.ts signal +919999999999 app_downloaded
npx tsx test-signal.ts signal +919999999999 si_filed
npx tsx test-signal.ts signal +919999999999 payment_done
npx tsx test-signal.ts signal +919999999999 activated
npx tsx test-signal.ts signal +919999999999 fod
```

### Debounce test (O2_si — rapid events, only one message sent)
```bash
npx tsx test-signal.ts start  +919999999999 swiggy
npx tsx test-signal.ts signal +919999999999 location_shared
npx tsx test-signal.ts signal +919999999999 app_downloaded
# Now in O2_si — send multiple events immediately:
npx tsx test-signal.ts signal +919999999999 doc_rejected
npx tsx test-signal.ts signal +919999999999 doc_uploaded
npx tsx test-signal.ts signal +919999999999 si_filed
# Worker logs: "debounce start" → "debounce reset" × 2 → "debounce end" after 2 min → one message
```

### Terminal event (immediate shutdown)
```bash
npx tsx test-signal.ts start  +919999999999 swiggy
npx tsx test-signal.ts signal +919999999999 not_interested
# Worker logs: terminal event detected → markGiveUp → cancelAllNudges → workflow ends
```

### Terminal during debounce
```bash
# While debounce window is running (send within 2 min of last event):
npx tsx test-signal.ts signal +919999999999 not_interested
# Debounce short-circuits immediately — terminal handling runs without waiting for quiet period
```

### Status check
```bash
npx tsx test-signal.ts status +919999999999
# Shows: Status (RUNNING / COMPLETED / TERMINATED), started time, task queue
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server gRPC address |
| `TEMPORAL_TASK_QUEUE` | `journey-workflow` | Task queue the worker is polling |

---

## vs. publish-event.ts

| | `test-signal.ts` | `publish-event.ts` |
|--|------------------|--------------------|
| Path | Direct Temporal gRPC | RabbitMQ → domain-event-system → Temporal |
| Tests | Workflow + worker only | Full stack |
| Requires | Temporal running | Temporal + RabbitMQ + domain-event-system |
| Latency | Immediate | ~100ms (queue hop) |
| Good for | Workflow logic, debounce, terminal events | End-to-end integration |
