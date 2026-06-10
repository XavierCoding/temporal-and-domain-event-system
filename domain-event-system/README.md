# domain-event-system

TypeScript service that bridges RabbitMQ Streams → Temporal signals for the Journey Engine.

## What it does

1. Consumes messages from the `journey-events` RabbitMQ stream
2. Parses and validates each message as a `DomainEvent`
3. Signals the `OnboardingJourney` Temporal workflow for the rider's phone number
4. Auto-starts a new workflow if one doesn't exist yet (first event for a rider)

## Prerequisites

- Node 18+
- RabbitMQ with Streams plugin enabled
- Temporal Server running (see temporal-journey-worker README)

## Quick start

### 1. Start RabbitMQ with streams support

```bash
docker run --rm -p 5672:5672 -p 15672:15672 \
  rabbitmq:3.13-management
```

Enable streams plugin (if not auto-enabled):
```bash
docker exec <container> rabbitmq-plugins enable rabbitmq_stream
```

### 2. Configure env

```bash
cp .env.example .env
# edit RABBITMQ_URL, TEMPORAL_ADDRESS as needed
```

### 3. Install & run

```bash
npm install
npm run dev
```

---

## Publishing a test event

Use the RabbitMQ Management UI at http://localhost:15672 (guest/guest),
or publish via amqplib:

```typescript
import amqplib from "amqplib";
const conn = await amqplib.connect("amqp://guest:guest@localhost:5672");
const ch = await conn.createChannel();
await ch.assertQueue("journey-events", { durable: true, arguments: { "x-queue-type": "stream" } });
ch.sendToQueue("journey-events", Buffer.from(JSON.stringify({
  phone_number: "+919999999999",
  event_type: "location_shared",
  client: "swiggy",
  emitted_at: new Date().toISOString(),
})));
await conn.close();
```

## Event types

See `src/types/domain-event.ts` for the full `EventType` enum.

Key events:
| Event | Effect |
|---|---|
| `location_shared` | D1 → O1 |
| `app_downloaded` | O1 → O2 |
| `si_filed` | O2 → O3 |
| `payment_done` | O3 → O4 |
| `activated` | O4 → O5 |
| `fod` | O5 → completed |
| `tc_assigned` | Pause + cancel engagement |
| `restart_journey` | Resume |
| `blocker_unresolvable` | Any stage → completed (give-up) |
