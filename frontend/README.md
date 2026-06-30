# Ajna Console — Fraud-Ops Dashboard

Next.js 16 (React 19, App Router) frontend for the Ajna fraud-intelligence platform. A real-time, multi-page fraud-operations console backed by a WebSocket stream from the FastAPI backend.

> ⚠️ This is **Next.js 16** with breaking changes from earlier versions. Read [`AGENTS.md`](./AGENTS.md) before editing and check `node_modules/next/dist/docs/` for current API docs — do not rely on training-data Next.js knowledge.

## Getting Started

```bash
npm install
npm run dev   # http://localhost:3000
```

The backend (FastAPI + risk engine + Docker infra) must be running first — see the repo-root `SETUP_AND_DEMO_GUIDE.md`. The API base + WebSocket URL are configured in `src/lib/utils.ts` (`API`, `WS_URL`, default `localhost:8000`).

## Structure

```
src/
├── app/
│   ├── page.tsx              # redirects → /feed
│   ├── layout.tsx            # root: fonts + ThemeProvider (default dark)
│   └── (console)/
│       ├── layout.tsx        # shell: AjnaProvider + Sidebar + Topbar + CopilotDock + EntityDialog
│       ├── feed/             # Live Risk Feed
│       ├── live/             # Session Monitor
│       ├── devices/          # High-risk devices
│       ├── accounts/         # High-risk accounts
│       ├── graph/            # Identity graph (Neo4j cluster)
│       ├── rings/            # Fraud rings
│       ├── history/          # Audit trail
│       ├── policies/         # Risk policies + thresholds
│       └── impact/           # Report summary / impact metrics
├── components/
│   ├── ui/                   # shadcn/ui primitives (Radix-based)
│   ├── shell/                # sidebar, topbar, copilot-dock, entity-dialog
│   └── *.tsx                 # identity-graph, risk-trajectory, risk-card, theme-*
└── lib/
    ├── store.tsx             # AjnaProvider / useAjna() — global state + single WebSocket
    ├── types.ts              # shared types
    └── utils.ts              # API/WS_URL config + cn() helper
```

## Stack

- **Next.js 16.2.6 / React 19**, App Router, `"use client"` console.
- **Tailwind v4** — configured via `postcss.config.mjs` (no `tailwind.config.js`).
- **shadcn/ui** (Radix primitives), **recharts** (charts), **next-themes** (dark/light), **lucide-react** (icons).
- Lint: `npm run lint` (ESLint 9 flat config, `eslint.config.mjs`).
