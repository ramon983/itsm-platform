# AdminZero

A modular ITSM platform built around the people using it: AI handles the routine triage, routing,
translation and diagnostics so human agents can spend their time on the hard problems.

| Module | Toggle (`ADMINZERO_ENABLED_MODULES`) | API |
|---|---|---|
| ITSM core: tickets, swarming, changes/CAB, versioned KB | `itsm` (always on) | `/api/v1/tickets`, `/changes`, `/kb` |
| Dual AI agents (intake + copilot), Claude Opus 5.5 | `ai` | `/api/v1/ai/intake`, `/ai/copilot/{id}` |
| SaaS management: discovery, shadow IT, idle seats, reclaim | `saas` | `/api/v1/saas/*` |
| ITAM / CMDB with lifecycle + MDM | `itam` | `/api/v1/assets/*` |
| Zero-knowledge vault with 1-hour JIT elevation | `vault` | `/api/v1/vault/*` |
| SIEM webhook (Splunk, Sentinel, Datadog) + correlation | `siem` | `POST /api/v1/siem/webhook?source=` |

GraphQL (read-only graph across tickets and assets) is at `/graphql`. OpenAPI docs are at `/docs`.

## Rules the code enforces
- **No status zoo.** There are exactly 5 statuses, with an explicit transition map (`app/services/tickets.py`). The SLA clock pauses in both `WAITING_ON_*` statuses, and the due date moves forward by the time spent paused.
- **No silent handoffs.** The only way to change a ticket's owner is `POST /tickets/{id}/handoff`, which requires a reason, what was already tried, and the next step. Each handoff writes a timeline event, sets the status to `ACTIVE_SWARM`, and publishes a domain event.
- **No assignee silos.** The default agent view, `/tickets/board`, has one column per status. Several agents can work a ticket together (`swarm_members`).
- **Resolving requires a KB article.** A ticket can only reach `RESOLVED_KB_LINKED` with a link to a published KB article.
- **AI answers must be grounded.** The copilot drops any recommendation or macro that doesn't cite a KB article that was actually supplied to it, and any JIT suggestion for a credential that wasn't supplied. The intake agent can't cite KB IDs that weren't in its context.
- **Vault.** The server only ever stores ciphertext. To get access you need an open ticket, approval from a different person, and the access expires after 60 minutes. Closing the ticket revokes access. Every attempt, including denied ones, is written to the audit log.
- **No hardcoded secrets.** In deployed environments, secrets come from Google Cloud Secret Manager (`GCP_PROJECT_ID`). The `.env` fallback only works when `ADMINZERO_ENV=development`.

## Develop
```bash
cd backend
cp .env.example .env          # add ANTHROPIC_API_KEY for the AI endpoints
uv sync
uv run pytest
uv run uvicorn app.main:app --reload
```
Auth: the API expects an identity-aware proxy in front of it that sets `X-Actor-Email` / `X-Actor-Roles`. Set these headers yourself when developing locally.

## Deploy
`.github/workflows/deploy.yml` runs lint and tests, builds `backend/Dockerfile`, pushes the image to Artifact Registry, and deploys to Cloud Run. Authentication uses keyless OIDC (Workload Identity Federation). Set these repo variables: `GCP_PROJECT_ID`, `GCP_REGION`, `ARTIFACT_REGISTRY_REPO`, `WIF_PROVIDER`, `DEPLOY_SERVICE_ACCOUNT`, `RUNTIME_SERVICE_ACCOUNT`. The runtime service account needs `roles/secretmanager.secretAccessor` for `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY` and `SIEM_WEBHOOK_SIGNING_KEY`.

## Prototype
`wireframes/index.html` is a self-contained interactive prototype with no backend, so it can be embedded in Google Sites (Insert → Embed → Embed code).

**Live prototype:** https://ramon983.github.io/itsm-platform/. `.github/workflows/pages.yml` redeploys it on every push to `develop` that changes `wireframes/`.
