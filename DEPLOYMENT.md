# Deployment

This repo deploys as **two independent Vercel projects** from the same monorepo:

| Project | Root directory | What it serves | Needs a database? |
| ------- | -------------- | -------------- | ----------------- |
| Demo    | `apps/demo`    | The live demo (`/lane`, `/lane-spa`, `/react-query`) **and** the team API at `/api` | Yes — Turso |
| Docs    | `apps/docs`    | The Nextra documentation site | No |

The demo is fully self-contained: the team-task API is embedded in the Next.js
app as a Route Handler (`apps/demo/src/app/api/[[...route]]/route.ts`, a Hono app
served through `hono/vercel`), so there is no separate backend to host. It talks
to a [Turso](https://turso.tech) (libSQL) database in production and to a local
SQLite file in development.

- **Local / CI:** no `TURSO_*` env vars → a SQLite file under `apps/demo/data/`
  (git-ignored). Created and seeded automatically on first request.
- **Production:** `TURSO_DATABASE_URL` is set → the app uses Turso over HTTP via
  `@libsql/client/web` (no native binary, which is what makes it work on Vercel's
  serverless runtime).

The switch is purely environment-driven — there is no production code path that
imports the legacy `node:sqlite` `/todos` API.

---

## 1. Create the Turso database

Install the CLI and sign in (one-time):

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
```

Create a database and read off the two values the demo needs:

```bash
# Create it (pick a region close to your Vercel functions, e.g. --location iad)
turso db create lane-demo

# 1) The database URL  → TURSO_DATABASE_URL  (looks like libsql://lane-demo-<org>.turso.io)
turso db show lane-demo --url

# 2) A long-lived auth token → TURSO_AUTH_TOKEN
turso db tokens create lane-demo
```

Keep the URL and token handy for the next step. You don't need to create any
tables — the app runs its schema migration and seed automatically on first
request (see [How seeding works](#how-seeding-works)).

---

## 2. Create the Vercel projects

Create **two** projects pointing at this same Git repository. The only thing
that differs is the **Root Directory**.

### Demo project

1. **New Project** → import this repository.
2. **Root Directory:** `apps/demo`.
3. Framework preset is detected as **Next.js**; build/install commands are pinned
   in [`apps/demo/vercel.json`](apps/demo/vercel.json), so leave the defaults.
4. Add the environment variables below, then deploy.

### Docs project

1. **New Project** → import the same repository again.
2. **Root Directory:** `apps/docs`.
3. Build/install commands are pinned in
   [`apps/docs/vercel.json`](apps/docs/vercel.json) (it runs the docs sync script
   before `next build --webpack`). No environment variables required.

> Vercel installs the whole pnpm workspace from the repo root automatically, so
> the workspace package `use-lane` (consumed from source) is available to the
> build. Nothing needs to be pre-built.

---

## 3. Configure environment variables (demo project)

Set these on the **demo** project under **Settings → Environment Variables**
(apply to Production, and to Preview if you want preview deployments to work
against the same data):

| Variable             | Required | Value | Notes |
| -------------------- | -------- | ----- | ----- |
| `TURSO_DATABASE_URL` | **Yes**  | `turso db show lane-demo --url` output | Switches the app from the local file to Turso. |
| `TURSO_AUTH_TOKEN`   | **Yes**  | `turso db tokens create lane-demo` output | Auth for the database. Treat as a secret. |
| `NEXT_PUBLIC_SITE_URL` | Optional | `https://your-domain.com` | The site's own origin, used by Server Components to call `/api` on themselves. If unset, the app falls back to Vercel's `VERCEL_URL` automatically — set this only if you want server-side fetches to go through your custom domain. |

Optional demo-behavior knobs (all have sensible defaults; usually leave unset):

| Variable | Default | Effect |
| -------- | ------- | ------ |
| `TEAM_API_READ_DELAY_MS` / `TEAM_API_WRITE_DELAY_MS` / `TEAM_API_PICKER_DELAY_MS` | `100` | Artificial latency so pending/optimistic states stay visible. Set to `0` to disable. |
| `API_RANDOM_FAIL_RATE` | `0` | `0`–`1` chance of injecting a failure, to demo error/recovery UI. |
| `API_RANDOM_FAIL_STATUS` | `503` | Status code used when a request is failed. |
| `API_RANDOM_FAIL_PATHS` | (all) | Comma-separated path prefixes to scope random failures to. |

> Why `NEXT_PUBLIC_SITE_URL` is only optional: the browser talks to `/api`
> same-origin (a relative URL), so it never needs a configured origin. Only the
> RSC seed/prefetch runs server-side and needs an absolute URL — and it derives
> one from `NEXT_PUBLIC_SITE_URL` → `VERCEL_URL` → localhost, in that order.

---

## 4. Custom domains

In each Vercel project: **Settings → Domains → Add**.

- **Demo:** add e.g. `demo.your-domain.com` (or the apex). If you point the demo
  at a custom domain and want the server-side `/api` self-calls to flow through
  it, also set `NEXT_PUBLIC_SITE_URL` to that URL (step 3) and redeploy.
- **Docs:** add e.g. `docs.your-domain.com`.

Follow Vercel's DNS instructions (a `CNAME` to `cname.vercel-dns.com`, or the
apex `A`/`ALIAS` records it shows).

---

## How seeding works

The team database schema (`create table if not exists …`) and the demo seed data
run **lazily on the first request after a cold start**, memoized so they run at
most once per instance:

- The seed is a no-op if the `teams` table already has rows, and every insert is
  `insert or ignore`, so it is safe to run repeatedly and across concurrent cold
  starts.
- Nothing runs at module-evaluation time, so `next build` never opens a
  connection — the build needs no database access.

To reset the demo to a clean state, drop and recreate the rows (or the whole
database) in Turso; the next request reseeds:

```bash
turso db shell lane-demo "delete from task_labels; delete from tasks; delete from labels; delete from projects; delete from team_members; delete from teams; delete from users;"
```

---

## Local development & tests (no Turso needed)

With no `TURSO_*` variables set, everything falls back to a local SQLite file —
nothing else to configure:

```bash
pnpm install
pnpm dev:demo        # demo on http://localhost:3006, API at /api
```

The Playwright E2E suite is self-contained too: it boots only the demo dev server
(serving its own `/api`) against a throwaway SQLite file that is removed before
each run.

```bash
pnpm test:e2e
```

---

## Quick verification after deploy

```bash
# API is up and seeded (default mock user is Maya Chen):
curl https://<your-demo-domain>/api/me

# A team-scoped list returns seeded tasks:
curl -H 'x-team-id: t_acme' https://<your-demo-domain>/api/tasks

# The RSC-seeded workspace renders:
open https://<your-demo-domain>/lane
```
