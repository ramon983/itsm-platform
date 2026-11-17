@AGENTS.md

# AdminZero — Principal Architect & UI/UX Spec

Product name: **AdminZero** (the original spec called it NexusITSM). A modular, human-centric ITSM,
Torii-style SaaS Governance, Hardware/Software ITAM (CMDB), and Enterprise JIT Password Vault platform.

Stack: Next.js (App Router, static export for GitHub Pages) + TypeScript + Tailwind CSS v4 + Zustand + lucide-react.
Backend (Phase 5): FastAPI in `backend/`, Google Cloud Secret Manager, Anthropic SDK, Cloud Run.
All work happens on the `develop` branch. Pages deploys from `develop`.

## 1. Zero-placeholder engineering law
- **No lazy code or dead buttons.** Never write `// TODO`, `// implement later`, or static unclickable mockups. Every
  button, modal, slide-over drawer, filter, toggle and form is wired to the reactive Zustand store
  (`src/store/usePlatformStore.ts`), and from Phase 5 to the FastAPI backend, with optimistic updates and toast feedback.
- **Human-centric AI.** AI automates trivial triage, multilingual translation, template mapping and log correlation so
  human agents can focus on empathetic, high-touch problem-solving.
- **Modular feature flags.** All 5 modules (`itsm_core`, `ai_agents`, `torii_saas`, `itam_cmdb`, `password_vault`) toggle
  ON/OFF at runtime, immediately updating navigation and dashboard widgets without breaking layout. `itsm_core` is the
  platform foundation and is locked ON.

## 2. Design system (Linear / Vercel / Console.com)
Never generate generic Bootstrap-style admin tables.
- App canvas `#090D16` (`bg-[#090D16] text-slate-100`).
- Elevated surface / card `#111827` (`bg-slate-900/80 backdrop-blur-md`).
- Hairline borders `border-white/[0.08]`, hover `border-white/[0.16]`.
- Primary accent: electric indigo `bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.25)]`.
- Status badges:
  - `AI_TRIAGED` sky `text-sky-400 bg-sky-500/10 border-sky-500/20`
  - `ACTIVE_SWARM` indigo `text-indigo-400 bg-indigo-500/10 border-indigo-500/20`
  - `WAITING_ON_CUSTOMER` / `WAITING_ON_VENDOR` (SLA paused) purple `text-purple-400 bg-purple-500/10 border-purple-500/20`
  - `RESOLVED_KB_LINKED` emerald `text-emerald-400 bg-emerald-500/10 border-emerald-500/20`
  - `P1_CRITICAL` rose `text-rose-400 bg-rose-500/10 border-rose-500/30 animate-pulse`
- Fonts: Inter (UI, `tracking-tight`, high density); JetBrains Mono for ticket IDs (`INC-1049`), asset tags (`MBP-0942`),
  live SLA timers (`00:42:18`), KB IDs (`KB-402`) and JSON.
- Global `Cmd+K` / `Ctrl+K` command palette: search any ticket, asset or SaaS app, or run macros.
- Right-side slide-over drawers (`w-[540px]`) for tickets, CMDB assets and SaaS licenses without losing queue context.
- Keyboard shortcut badges on primary actions (`[E]` Execute Macro, `[T]` Translate, `[P]` Pause SLA).

## 3. Domain anti-patterns enforced in code (`src/lib/rules.ts`)
1. **No Jira status zoo.** Exactly 5 statuses: `AI_TRIAGED`, `ACTIVE_SWARM`, `WAITING_ON_CUSTOMER`, `WAITING_ON_VENDOR`,
   `RESOLVED_KB_LINKED`. Moving to `WAITING_*` sets `slaPaused = true` and freezes the SLA countdown. Moving to
   `RESOLVED_KB_LINKED` requires linking or creating a Knowledge Base article.
2. **No silent handoffs.** Reassigning or transferring to another swarm squad opens the mandatory `HandoffContextModal`
   (`handoffReason`, `diagnosticsAttempted`, `recommendedNextStep`) and appends a permanent Handoff Audit Card to the timeline.
3. **No assignee silos.** Kanban boards are grouped by collaborative swarm squads (`Network & Identity`, `Endpoint & Mac`,
   `SaaS & Cloud Ops`, `Security & SIEM`) with overlapping agent avatars — never by individual assignee.
4. **Zero hardcoded secrets.** Backend loads `ANTHROPIC_API_KEY`, `DATABASE_URL`, `SIEM_WEBHOOK_SECRET`, `VAULT_KMS_KEY`
   from Google Cloud Secret Manager, with `.env.local` fallback only for offline dev.

## 4. Core schemas
`src/types/platform.ts` implements the spec's `TicketStatus`, `TicketPriority`, `SwarmSquad`, `TicketMessage` and
`Ticket` interfaces exactly; supporting entities (assets, SaaS apps, vault items, flags, telemetry) extend around them.

## Information architecture (platform restructure)
- Every page belongs to a module (`VIEW_MODULE` in `AppShell.tsx`); when a module is off, its nav section, Home widgets
  and side panels disappear and its pages fall back to Home.
- Home · ITSM (Tickets, Problems, Changes, Knowledge) · AI agents (Employee portal) · SaaS · Assets · Security (Vault) · Admin.
- The AI copilot (`CopilotPanel`, `src/lib/copilot.ts`) lives inside Tickets, Problems and Changes: similar closed tickets,
  KB matches with confidence + reasons, next best action, bilingual drafts. It suggests; humans approve.
- Knowledge pattern detection (`src/lib/patterns.ts`) clusters recurring tickets, drafts articles from real resolutions,
  and published self-service articles deflect employees in the portal before a ticket exists.
- Admin: modules, people & squads, SLA policies, no-code automations, fields & statuses (capped), AI & grounding,
  integrations, immutable audit log (every store mutation writes one).

## Build phases
1. Scaffold, pre-seeded reactive store, app shell, swarming dashboard. ✅
2. Multilingual end-user chat portal and live template mapper (`EndUserPortalView.tsx`). ✅ Offline deterministic mapper in `src/lib/intake.ts`; Phase 5 swaps in Claude.
3. Omnichannel agent workspace and grounded agent-assist copilot (`AgentWorkspaceView.tsx`).
4. Torii-style SaaS governance and hardware/software ITAM (`AssetsSaasView.tsx`).
5. Admin console, password vault, Open API / SIEM playground, FastAPI + Secret Manager + Cloud Run backend.

## Commands
- `npm run dev` — local dev server
- `npm run lint` · `npm run typecheck` · `npm test` — must all pass before committing
- `npm run build` — static export to `out/` (set `PAGES_BASE_PATH=/itsm-platform` for GitHub Pages)
