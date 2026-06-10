# Journey Engine — Hackathon

Rider onboarding journey system built on **Temporal** + **RabbitMQ**. Two services work together:

- **`temporal/`** — Temporal worker that runs `OnboardingJourney` and `IntentJourney` workflows
- **`domain-event-system/`** — Consumes RabbitMQ stream events and signals the correct Temporal workflow

```
RabbitMQ stream (journey-events)
    └── domain-event-system
            └── signals Temporal
                    └── OnboardingJourney / IntentJourney workflows
                            ├── WhatsApp nudges (via WA service)
                            └── Outbound calls (via Samvadini service)
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Both services |
| Docker | any | Temporal + RabbitMQ |
| PostgreSQL | 14+ | Journey config + state |

---

## Step 1 — Start infrastructure

### Temporal (local dev)

```bash
docker run --rm -p 7233:7233 -p 8233:8233 temporalio/auto-setup:1.24.2
```

Temporal UI → http://localhost:8233

### RabbitMQ with Streams

```bash
docker run --rm -p 5672:5672 -p 15672:15672 rabbitmq:3.13-management
```

Enable the streams plugin (required — run once after container starts):

```bash
docker exec $(docker ps -qf ancestor=rabbitmq:3.13-management) rabbitmq-plugins enable rabbitmq_stream
```

RabbitMQ Management UI → http://localhost:15672 (guest / guest)

### PostgreSQL

Create the database used by the temporal worker:

```bash
createdb journey
# or via psql:
psql -c "CREATE DATABASE journey;"
```

---

## Step 2 — Set up the Temporal worker (`temporal/`)

```bash
cd temporal
npm install
cp .env.example .env
```

Edit `.env`:

```env
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=journey-workflow
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/journey
SV_WA_SERVICE_URL=http://localhost:8000       # WhatsApp service (or mock)
SV_OUTBOUND_SERVICE_URL=http://localhost:8723  # Outbound call service (or mock)
LOG_LEVEL=info
```

Seed the journey config into Postgres:

```bash
npm run seed
```

Start the worker:

```bash
npm run dev        # watch mode — no build needed
# or for production:
npm run build && npm start
```

---

## Step 3 — Set up the domain event system (`domain-event-system/`)

```bash
cd domain-event-system
npm install
cp .env.example .env
```

Edit `.env`:

```env
RABBITMQ_URL=amqp://guest:guest@localhost:5672
STREAM_NAME=journey-events
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=journey-workflow
LOG_LEVEL=info
```

Start the consumer:

```bash
npm run dev
```

---

## Step 4 — Start mock services (optional, for local testing)

From the repo root — mocks the WhatsApp (`:8000`) and outbound call (`:8723`) endpoints:

```bash
npm install
npm run mock-sv
```

Start the `/callAction` API server (used by Samvadini to report call outcomes):

```bash
npm run call-action
```

---

## Step 5 — Publish a test event

### Via the root helper script

```bash
npm run test
# or publish a specific event:
npx tsx publish-event.ts
```

### Manually via amqplib

```typescript
import amqplib from "amqplib";

const conn = await amqplib.connect("amqp://guest:guest@localhost:5672");
const ch = await conn.createChannel();
await ch.assertQueue("journey-events", {
  durable: true,
  arguments: { "x-queue-type": "stream" },
});
ch.sendToQueue(
  "journey-events",
  Buffer.from(
    JSON.stringify({
      phone_number: "+919999999999",
      event_type: "location_shared",
      client: "swiggy",
      emitted_at: new Date().toISOString(),
    })
  )
);
await conn.close();
```

---

## Onboarding stage flow (Swiggy)

```
D1_location → O1_app_download → O2_si → O3_payment → O4_activation → O5_first_order → completed
```

### Event → stage transitions

| Event type | Transition |
|---|---|
| `location_shared` | D1 → O1 |
| `app_downloaded` | O1 → O2 |
| `si_filed` | O2 → O3 |
| `payment_done` | O3 → O4 |
| `activated` | O4 → O5 |
| `fod` | O5 → completed |
| `tc_assigned` | Any stage → pause + cancel engagement |
| `restart_journey` | Resume after TC pause |
| `blocker_unresolvable` | Any stage → give-up |
| `samvadini_interested` | Triggers `IntentJourney` pre-qualification |

---

## Project structure

```
hackathon/
├── temporal/                   # Temporal worker
│   ├── src/
│   │   ├── workflows/          # OnboardingJourney, IntentJourney
│   │   ├── activities/         # WA, call, journey, intent activities
│   │   ├── schemas/            # Zod schemas (DomainEvent, ActionArgs)
│   │   └── worker.ts           # Entry point
│   ├── seed-config.ts          # Seeds journey_config table
│   └── .env.example
├── domain-event-system/        # RabbitMQ → Temporal bridge
│   ├── src/
│   │   ├── rabbitmq/           # Stream consumer
│   │   ├── temporal/           # Temporal client + journey signaler
│   │   └── types/              # DomainEvent types
│   └── .env.example
├── mock-sv.ts                  # Mock WA + outbound services
├── call-action-server.ts       # /callAction API
├── publish-event.ts            # Test event publisher
└── test-signal.ts              # CLI for sending Temporal signals
```
