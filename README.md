# AdminZero

AdminZero is a human-centric ITSM platform with Torii-style SaaS governance, hardware/software ITAM (CMDB) and a Just-In-Time password vault. The AI takes care of triage, translation, template mapping and log correlation, so agents can spend their time on the people they're helping.

**Live agent dashboard:** https://ramon983.github.io/itsm-platform/ (deployed from `develop`)

## The platform
AdminZero is built as a platform: every module can be turned on and off in **Admin → Modules**. When a module is off, its navigation, Home widgets and side panels disappear.

| Section | What it does |
|---|---|
| **Home** | What needs a human now: P1s, SLA risk and urgent client impact. Also KPIs, swarm load by squad, the AI + human split, AI insights, the Arcade leaderboard and SIEM telemetry. |
| **Tickets** | A unified omnichannel inbox: a queue filtered by All / P1 / Waiting / My swarms / squad, one timeline across channels, and a reply or internal-note composer. You can switch to a swarm board. |
| **Problems** | Root causes behind repeat incidents, linked to open and closed tickets. A root cause is required before Known error, and the workaround can be published to Knowledge. |
| **Changes** | Transparent CAB risk scoring: low-risk changes skip CAB. Includes a 7-day schedule, Jira release links and approve/reject. You can't approve your own change. |
| **Knowledge** | Articles with views, self-service count and versions. **AI pattern insights** finds recurring tickets with no article, drafts one from your agents' actual fixes, and once you publish it, the portal answers those employees without a human. |
| **Employee portal** | Multilingual chat intake. It offers a self-service article first, then maps the conversation to a ticket. |
| **SaaS · CMDB · Vault** | Idle-seat reclaim, unlimited assets, and 1-hour JIT credentials tied to tickets. |
| **Admin** | Modules, people & squads, SLA policies, a no-code automation builder (When → If → Then), fields & statuses (capped, to avoid the "Jira trap"), AI autonomy and grounding sources, integrations, and an immutable audit log with CSV export. |

**AI Copilot.** Inside Tickets, Problems and Changes, the copilot shows similar closed tickets and what fixed them, KB matches with a confidence score and the reasons for it, the next best action, and bilingual reply drafts. Every suggestion cites its source. If nothing internal matches, it says so; a labelled internet fallback covers basic IT questions only. Macros always need a human to run them.

## Earlier phases
- **App shell.** A collapsible sidebar that shows only the modules you've enabled, with live counts. It also has a Level / XP bar and a Reset Demo State button. The top bar holds the ⌘K / Ctrl+K command palette, toggle pills for each module, and a Secret Manager status indicator.
- **Unified swarming dashboard.** Five KPI cards (Open Incidents, First Contact Resolution, MTTR, SLA Compliance, Monthly SaaS Spend with reclaimable savings) that recalculate from live state.
- **Anti-silo swarm board.** One column per swarm squad, never per assignee. You can filter by any of the 5 statuses or show P1s only. Dragging a card to another squad opens the handoff modal.
- **Ticket inspector drawer.**
  - The SLA timer is live, and freezes while a ticket is in either `WAITING_*` status.
  - Changing the squad opens the mandatory Handoff Context modal.
  - Resolving requires linking an existing KB article or publishing a new one.
  - Shortcut keys: `[E]` runs the AI macro, `[T]` toggles translations, `[P]` pauses or resumes the SLA.
- **Cross-module & SIEM telemetry feed.** "Simulate Sentinel SIEM Alert" injects an MFA brute-force alert on `MBP-0942` and creates a P1 ticket.
- **Inspectors.** Asset and SaaS inspectors (including idle-seat reclaim), plus 1-hour JIT vault access tied to a ticket ID.

## Phase 2: end-user portal (`#portal`)
- **Chat.** A chat-first intake with language detection badges and a typing indicator. It has one-click presets in Spanish, French, Japanese and German, and you can also type freeform messages.
- **Live inspector.** The panel beside the chat runs 3 animated AI steps and then fills in, section by section:
  - language, sentiment and auto-priority (it shows why each priority was chosen)
  - the empathetic reply in the user's language, with an English version for the agent
  - the matched predefined template, with each field filled in or marked missing
  - the auto-attached CMDB asset and the user's active SaaS licences
- **Submit & Route to Swarm Queue.** Creates the ticket in the store, so it appears on the swarm board straight away.
- **Offline mode.** With no backend connected, `src/lib/intake.ts` is a deterministic offline mapper. It writes native replies in English, Spanish, French, German, Japanese, Portuguese and Italian. If a critical field is missing it asks one clarifying question, and it only suggests self-service steps that come from KB articles.

Everything runs against a Zustand store (`src/store/usePlatformStore.ts`) that saves to localStorage. It starts with seed data: 8 multilingual tickets, 6 CMDB assets, 6 SaaS apps, 5 vault items and 5 feature flags.

## Develop
```bash
npm install
npm run dev        # http://localhost:3000
npm run lint && npm run typecheck && npm test
npm run build      # static export → out/
```

The rules every phase must follow are in [`CLAUDE.md`](CLAUDE.md).

## Backend (Phase 5): FastAPI + Claude + Google Cloud Secret Manager
The backend lives in `backend/`. The entry point is `main.py` (`uvicorn main:app`).

| Endpoint | What it does |
|---|---|
| `GET /api/v1/health` | Where secrets come from (Secret Manager or `.env.local`), which ones resolved (names only, never values), and the AI engine in use |
| `POST /api/v1/tickets/intake` | Conversational Intake Agent: Claude Opus 5.5 with **Runtime System Prompt 1**, returned as structured JSON |
| `POST /api/v1/agent/assist` | Agent-Assist Copilot: **Runtime System Prompt 2**. Recommendations without a KB citation are removed. |
| `POST /api/v1/siem/webhook?source=sentinel\|splunk\|datadog` | HMAC-SHA256 signed and replay-protected. Correlates the alert to the CMDB and returns a ready-to-create P1. |
| `GET /api/v1/saas/discovery` | SaaS spend, seats and reclaimable savings |

- **Secrets:** `ANTHROPIC_API_KEY`, `DATABASE_URL`, `SIEM_WEBHOOK_SECRET` and `VAULT_KMS_KEY` are read at runtime with `SecretManagerServiceClient`. `.env.local` is only used in development; anywhere else, starting without `GCP_PROJECT_ID` is an error.
- **When Claude is unavailable** (no key, an outage, a refusal or rate limiting), both AI endpoints return deterministic structured answers in the same response shape. Claude's own refusals first go through the API's server-side fallback model.
- **Develop:** `cd backend && cp .env.local.example .env.local && uv sync && uv run uvicorn main:app --reload --port 8080`. Tests: `uv run pytest`.

### Deploy to Cloud Run
1. `PROJECT_ID=<gcp-project> REGION=us-central1 ./backend/scripts/setup_gcp.sh` creates the Artifact Registry repo, the service accounts, the secrets (it prompts for their values) and keyless GitHub OIDC (Workload Identity Federation). It then prints the repo variables to set.
2. Push to `develop`. `.github/workflows/deploy.yml` tests, builds and deploys `adminzero-api-dev`; pushing to `main` deploys `adminzero-api`. The deploy step skips until those variables exist.
3. The service is **private by default**. To let the public GitHub Pages dashboard call it, you would have to run `gcloud run services add-iam-policy-binding adminzero-api-dev --region us-central1 --member=allUsers --role=roles/run.invoker`. Only do that knowingly: the AI endpoints are rate-limited per IP, but they still spend Anthropic credit.
4. Set the `ADMINZERO_API_URL` repo variable to the service URL. The next Pages build switches the dashboard from browser simulation to the live API.

### Admin → API & webhooks
The playground lets you edit a payload, fire it, and watch a correlated P1 appear on the board. It shows the HMAC headers, the status, the latency and a `curl` equivalent. The signing secret is typed into the page and never stored. With no backend configured, the same contract runs in the browser and is labelled **Simulated**.
