# temporal-journey-worker

Temporal workflow worker for the Samvadini Journey Engine.
Runs `OnboardingJourney` — a nudge-ladder workflow that drives riders through onboarding stages.

## Prerequisites

- Node 18+
- Temporal Server (local dev)
- PostgreSQL

## Quick start

### 1. Start Temporal (local dev)

```bash
docker run --rm -p 7233:7233 -p 8233:8233 temporalio/auto-setup:1.24.2
```

Temporal UI → http://localhost:8233

### 2. Create the Postgres database

```bash
createdb journey
# or via psql:
psql -c "CREATE DATABASE journey;"
```

### 3. Configure env

```bash
cp .env.example .env
# edit .env — set DATABASE_URL, and SV_* URLs if testing integration
```

### 4. Install dependencies

```bash
npm install
```

### 5. Seed journey config

```bash
npm run seed
```

Seeds the `journey_config` table with the Swiggy 6-stage config.

### 6. Run the worker

```bash
npm run dev        # tsx (watch mode, no build needed)
# or
npm run build && npm start
```

---

## Testing with Temporal UI / tctl

### Start a workflow manually

```bash
npx ts-node -e "
import { Client, Connection } from '@temporalio/client';
(async () => {
  const conn = await Connection.connect({ address: 'localhost:7233' });
  const client = new Client({ connection: conn });
  await client.workflow.start('OnboardingJourney', {
    taskQueue: 'journey-workflow',
    workflowId: 'journey-+919999999999',
    args: ['+919999999999', 'swiggy'],
  });
  console.log('started');
  await conn.close();
})();
"
```

Or use the Temporal UI at http://localhost:8233 to start a workflow manually.

### Signal a domain event

```bash
# Using tctl (if installed):
tctl workflow signal \
  --workflow_id journey-+919999999999 \
  --name domain_event \
  --input '{"phone_number":"+919999999999","event_type":"location_shared","client":"swiggy","emitted_at":"2026-06-09T00:00:00Z"}'
```

Or send a signal from the Temporal UI.

---

## Architecture

```
domain-event-system (TypeScript)
  └── consumes RabbitMQ stream "journey-events"
      └── signals Temporal → OnboardingJourney workflow

temporal-journey-worker (this service)
  └── OnboardingJourney workflow
      ├── stage loop
      │   ├── on_enter action
      │   ├── demand check (O5)
      │   ├── min_wait (O4)
      │   └── nudge ladder
      │       ├── condition(event | paused, wait_hours)
      │       ├── timeout → send nudge (open=free-form, closed=template)
      │       └── last rung timeout → on_exhaust + give_up
      └── signals
          ├── domain_event   → advance stage or push to event queue
          ├── tc_assigned    → pause + cancel all engagement
          └── restart_journey → resume
```

## Stage flow (Swiggy)

```
D1_location → O1_app_download → O2_si → O3_payment → O4_activation → O5_first_order → completed
```

Each stage has a 3-rung ladder: nudge at T+Xh, T+1d, T+3d → voice call on exhaust → give_up.
