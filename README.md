# AdminZero

AdminZero is a human-centric ITSM platform with Torii-style SaaS governance, hardware/software ITAM (CMDB) and a Just-In-Time password vault. The AI takes care of triage, translation, template mapping and log correlation, so agents can spend their time on the people they're helping.

**Live agent dashboard:** https://ramon983.github.io/itsm-platform/ (deployed from `develop`)

## What's in this build (Phase 1: agent side)
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
