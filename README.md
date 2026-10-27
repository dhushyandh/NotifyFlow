# NotifyFlow

NotifyFlow is a reliable, production-grade notification delivery and queuing system built with Node.js, Express 5, Prisma 7, and PostgreSQL. It features robust request idempotency, transactional queue processing with database-backed worker leases, exponential retry policies, automatic abandoned lease recovery, and Resend email integration.

---

## Architecture Overview

```
                                      ┌─────────────────────────────────────┐
                                      │        Client / Application         │
                                      └──────────────────┬──────────────────┘
                                                         │
                                    POST /api/v1/notifications
                                    (with optional Idempotency-Key)
                                                         │
                                                         ▼
                                      ┌─────────────────────────────────────┐
                                      │           Express 5 API             │
                                      │  - Zod Request Schema Validation    │
                                      │  - SHA-256 Idempotency Engine       │
                                      │  - Timing-Safe Internal Auth        │
                                      └──────────────────┬──────────────────┘
                                                         │
                                           Status: "queued" (Initial)
                                                         │
                                                         ▼
                                      ┌─────────────────────────────────────┐
                                      │       PostgreSQL Queue (Neon)       │
                                      │  - Idempotency Unique Constraints   │
                                      │  - Status & Lease Indexing          │
                                      └─────────────▲──────────┬────────────┘
                                                    │          │
                       SELECT FOR UPDATE SKIP LOCKED│          │ Worker Leases
                      (Concurrency-Safe Job Claiming)│          │ (60s Expiration)
                                                    │          ▼
                                      ┌─────────────────────────────────────┐
                                      │       Background Worker Runner      │
                                      │  - Expired Lease Recovery Loop      │
                                      │  - Exponential Backoff Retries      │
                                      │  - Graceful Shutdown (AbortSignal)  │
                                      └──────────────────┬──────────────────┘
                                                         │
                                                Dispatches Email
                                            (Resend Idempotency Key)
                                                         │
                                                         ▼
                                      ┌─────────────────────────────────────┐
                                      │          Resend Email API           │
                                      └─────────────────────────────────────┘
```

### Core Design Principles
1. **Ingestion Idempotency**: Safe client retries using client-supplied `Idempotency-Key` headers. Replaying an identical payload returns the original notification (`200 OK`, `replayed: true`), while reusing a key with a conflicting payload is rejected with `409 Conflict`.
2. **Database-Backed Queue**: Instead of requiring Redis or an external broker, NotifyFlow implements reliable queueing directly in PostgreSQL using `FOR UPDATE SKIP LOCKED`. Multiple workers claim jobs without locking conflicts or race conditions.
3. **Worker Leases & Heartbeat Recovery**: Claimed jobs are assigned a unique `leaseToken` and a 60-second `leaseExpiresAt`. If a worker dies mid-processing, `recoverExpiredLeases()` detects the expired lease and safely requeues the job (or marks it failed if maximum attempts were reached).
4. **Conditional Updates**: Workers write completion or retry updates conditionally based on matching `leaseToken` and valid expiration, preventing split-brain state overwrites.
5. **Provider Idempotency**: External email dispatches pass deterministic idempotency keys (`notifyflow/notification/${id}`) to Resend to minimize duplicate outbound emails on network timeouts.

---

## Delivery Guarantees & Retries

### Realistic Semantics
- **Ingestion**: **Exactly-once ingestion** when clients provide an `Idempotency-Key`. Duplicate network requests will not create redundant database rows.
- **Dispatch**: **At-least-once delivery**. In any distributed architecture involving external third-party providers (such as Resend, Twilio, or AWS SES), network partitions during provider acceptance acknowledgment can lead to retries. While NotifyFlow passes upstream provider idempotency keys where supported, downstream mail transfers (SMTP) and provider edge cases mean absolute exactly-once delivery cannot be guaranteed.

### Retry & Backoff Schedule
When a delivery attempt fails:
- **Base delay**: 5,000 ms (5 seconds).
- **Multiplier**: Exponential backoff doubling each attempt ($5 \times 2^{\text{attempt}-1}$ seconds).
- **Maximum delay ceiling**: 15 minutes (900,000 ms).
- **Maximum attempts**: Default 3 attempts. When attempts reach `maxAttempts`, the status transitions to `failed` and no further attempts are scheduled.

---

## Environment Variables

Copy `.env.example` to `apps/api/.env` and configure your credentials:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | No | `3000` | Port for the Express API server. |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`). |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string (supports Neon connection pooling with SSL). |
| `INTERNAL_API_KEY` | **Yes** | — | Shared secret required for internal status transition endpoints (`PATCH /api/v1/notifications/:id/status`). |
| `RESEND_API_KEY` | Optional* | — | Resend API key for outbound emails. Required for processing email jobs in worker. |
| `EMAIL_FROM` | Optional* | — | Verified sender address (e.g. `NotifyFlow <onboarding@resend.dev>`). |
| `WORKER_POLL_INTERVAL_MS`| No | `1000` | Polling interval in ms for the background queue worker (minimum 250ms). |

*\*Automated tests mock email dispatch and do not require real provider credentials.*

---

## Local Setup & Installation

### 1. Prerequisites
- Node.js >= 20.x
- npm >= 9.x
- A PostgreSQL database (e.g. Neon Serverless Postgres)

### 2. Install Dependencies
Run from the repository root:
```bash
npm install
```

### 3. Generate Prisma Client & Verify Migrations
NotifyFlow uses Prisma 7 with configuration loaded via `prisma7.config.ts`:

```bash
# Generate the Prisma client in apps/api/src/generated/prisma
npm run prisma:generate

# Verify database migration status
npm run prisma:status
```

---

## Running the Application

The API and Background Worker are designed as independent processes that can be run together during development or scaled independently in production.

### Starting the API Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm run start
```
The API starts at `http://localhost:3000`.

### Starting the Background Worker
In a separate terminal:
```bash
npm run worker
```
The worker will:
1. Recover any abandoned worker leases.
2. Claim queued notifications using `SELECT ... FOR UPDATE SKIP LOCKED`.
3. Process deliveries and record provider acceptance details (`providerMessageId`, `providerAcceptedAt`).
4. Handle shutdown signals gracefully (`SIGINT`, `SIGTERM`), allowing in-flight jobs to finish.

---

## Automated Tests & Quality Gates

All automated tests use Node.js's built-in test runner via `tsx --test`.

```bash
# Run tests from the root workspace
npm test

# Or run directly inside apps/api
cd apps/api
npm test
```

### Safe Testing Guarantee
Automated tests **never send real emails**. The Resend client integration is mocked with dependency injection in unit tests, validating payloads and provider idempotency keys without external side-effects or network dependencies.

### Test Coverage Highlights
- **Health check**: `GET /api/v1/health` verification.
- **Validation endpoint**: `POST /api/v1/notifications/validate` dry-run validation.
- **Notification Creation & Retrieval**: Persistence, initial status `queued`, retrieval by ID, 404 for missing records.
- **Pagination**: Page and limit validation, boundary limits, total counts.
- **Idempotency**: Empty/invalid key rejection, first-request 201 creation, identical key replay (`200 OK`, `replayed: true`), key reuse with conflicting payload (`409 Conflict`).
- **Internal API Key Authorization**: Constant-time key comparison, missing key rejection (503), invalid key rejection (401), authorized status updates.
- **Status Lifecycle**: State machine transitions (`pending` -> `queued` -> `processing` -> `sent` / `failed`), terminal state immutability.
- **Worker & Recovery**: Lease claiming with `SKIP LOCKED`, retry delay calculations, lease expiration recovery, provider detail tracking, and state-change conflict detection.

---

## API Reference

### 1. API Metadata
```http
GET /
```
**Response (`200 OK`)**:
```json
{
  "name": "NotifyFlow API",
  "version": "0.1.0",
  "message": "Business messaging automation starts here."
}
```

### 2. Health Check
```http
GET /api/v1/health
```
**Response (`200 OK`)**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-27T15:00:00.000Z"
}
```

### 3. Dry-Run Validation
Validates request body against the schema without writing to the database or triggering queues.
```http
POST /api/v1/notifications/validate
Content-Type: application/json

{
  "channel": "email",
  "recipient": "alex@example.com",
  "message": "Your order #1234 has shipped."
}
```
**Response (`200 OK`)**:
```json
{
  "valid": true,
  "notification": {
    "channel": "email",
    "recipient": "alex@example.com",
    "message": "Your order #1234 has shipped."
  },
  "message": "Request validated. No message has been sent."
}
```

### 4. Create Notification (with Idempotency)
```http
POST /api/v1/notifications
Content-Type: application/json
Idempotency-Key: order-created-1234-attempt-1

{
  "channel": "email",
  "recipient": "alex@example.com",
  "message": "Your order #1234 has shipped."
}
```

**New Request (`201 Created`)**:
```json
{
  "message": "Notification saved successfully",
  "replayed": false,
  "notification": {
    "id": "cuid_xyz",
    "recipient": "alex@example.com",
    "channel": "email",
    "message": "Your order #1234 has shipped.",
    "status": "queued",
    "idempotencyKey": "order-created-1234-attempt-1",
    "attemptCount": 0,
    "maxAttempts": 3,
    "createdAt": "2026-10-27T15:00:00.000Z",
    "updatedAt": "2026-10-27T15:00:00.000Z"
  }
}
```

**Replayed Request with Same Payload (`200 OK`)**:
```json
{
  "message": "Existing notification returned",
  "replayed": true,
  "notification": {
    "id": "cuid_xyz",
    "recipient": "alex@example.com",
    "channel": "email",
    "message": "Your order #1234 has shipped.",
    "status": "queued",
    "idempotencyKey": "order-created-1234-attempt-1",
    "attemptCount": 0,
    "maxAttempts": 3
  }
}
```

**Conflicting Payload with Reused Key (`409 Conflict`)**:
```json
{
  "error": "Idempotency key already used with a different payload"
}
```

**Invalid Idempotency Key (`400 Bad Request`)**:
```json
{
  "error": "Invalid Idempotency-Key",
  "details": "Provide a non-empty key of at most 255 characters."
}
```

### 5. List Notifications
```http
GET /api/v1/notifications?page=1&limit=20
```
**Response (`200 OK`)**:
```json
{
  "data": [
    {
      "id": "cuid_xyz",
      "recipient": "alex@example.com",
      "channel": "email",
      "message": "Your order #1234 has shipped.",
      "status": "sent",
      "attemptCount": 1,
      "providerMessageId": "email_abc123",
      "providerAcceptedAt": "2026-10-27T15:01:00.000Z",
      "createdAt": "2026-10-27T15:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### 6. Get Notification by ID
```http
GET /api/v1/notifications/:id
```
**Response (`200 OK`)**:
```json
{
  "notification": {
    "id": "cuid_xyz",
    "recipient": "alex@example.com",
    "channel": "email",
    "message": "Your order #1234 has shipped.",
    "status": "sent"
  }
}
```

### 7. Internal Status Transition
Protected endpoint for internal lifecycle updates.
```http
PATCH /api/v1/notifications/:id/status
Content-Type: application/json
x-internal-api-key: your-internal-api-secret-key

{
  "status": "processing"
}
```
**Response (`200 OK`)**:
```json
{
  "message": "Notification status updated",
  "notification": {
    "id": "cuid_xyz",
    "status": "processing"
  }
}
```

---

## Production Deployment Readiness

### Deployment Architecture
- **Web Process**: Run `npm run start` (starts the Express server). Configure health checks pointing to `/api/v1/health`.
- **Worker Process**: Run `npm run worker` (starts the persistent queue worker). Can be scaled independently.
- **Graceful Shutdown**: Both the API and Worker processes listen for `SIGINT` and `SIGTERM`. The API stops taking new requests, waits for in-flight requests, and disconnects Prisma. The worker finishes its current iteration, releases AbortSignals, and disconnects Prisma before process exit.

### External Setup Checklist
Before deploying to production:
1. **Neon Database**: Verify connection string pooler configuration (`sslmode=require`) in your production hosting environment.
2. **Resend Domain**: In the [Resend Dashboard](https://resend.com/domains), verify your custom sending domain (SPF, DKIM, DMARC) and update `EMAIL_FROM` with your verified domain.
3. **Internal Key**: Generate a cryptographically random string (e.g. `openssl rand -hex 32`) for `INTERNAL_API_KEY`.
4. **Environment Variables**: Add all required variables in your hosting provider's dashboard (e.g., Render, Railway, AWS ECS).

---

## License
MIT
