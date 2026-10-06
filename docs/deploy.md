# Deploying

Host-agnostic notes for running the app in production. Nothing here depends on a particular platform; once hosting is chosen, add its config next to this file.

## The pieces

| Piece | What it is | Runs as |
| --- | --- | --- |
| API | Fastify server (`apps/api`) | The server image, command `api` (the default). Listens on `$PORT` (4000). |
| Feed worker | Polls feeds on a schedule (`apps/feed-worker`) | The same image, command `worker`. One or more instances; they share work safely. |
| Migrations | SQL in `packages/catalog/src/db/migrations` | Applied by the API on start, or by the image's `migrate` command as a release step (then set `MIGRATE_ON_START=false`). |
| Database | PostgreSQL 16 | A managed service. |
| Web app | Static files from `expo export` | Any static host or CDN, with the rewrite rules below. |
| Phone apps | iOS and Android builds | EAS Build (needs the Apple and Google accounts in `TODO.md`). |

## Server image

```sh
docker build -t podcast-server .
docker run --env-file prod.env -p 4000:4000 podcast-server            # API
docker run --env-file prod.env podcast-server worker                    # feed worker
docker run --env-file prod.env podcast-server migrate                   # migrations only
```

The image runs as the `node` user and has a health check on `/health`. CI builds it and runs migrate, API and worker against Postgres on every push.

- `GET /health`: the process is up (liveness).
- `GET /ready`: it can also reach the database (readiness). Point the load balancer here.

Both stop cleanly on `SIGTERM`: the API finishes requests in flight; the worker finishes the feeds it's fetching.

## API settings

Set these in the host's secret settings. In production (`NODE_ENV=production`, which the image sets), the API checks them on start and refuses to run, listing every problem, if any required one is missing or unsafe.

| Setting | Production | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Required | Postgres connection string. |
| `AUTH_SECRET` | Required, 32+ characters | `openssl rand -base64 32`. Changing it signs everyone out. |
| `WEB_URL` | Required, https | The web app's exact origin, e.g. `https://listen.example.com`. Sign-in and share links point there, and it's the only origin allowed to call the API with credentials. If the web app can't load data, check this first. |
| `EMAIL_PROVIDER` | `resend` or `postmark` | `log` is refused in production: it would write sign-in codes to the log. |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Required with a provider | The sender's domain must be verified with the provider. |
| `TRUST_PROXY` | When behind a proxy | `1` for one load balancer in front. Without it, every request looks like it comes from the proxy: rate limits would be shared by all users, and https wouldn't be detected (no secure cookie, no HSTS). |
| `PODCAST_INDEX_KEY`, `PODCAST_INDEX_SECRET` | For search and charts | Both or neither. |
| `CORS_ORIGINS` | Optional | Extra origins, comma-separated. |
| `MIGRATE_ON_START` | Optional | Default `true`. |
| `PORT`, `HOST`, `LOG_LEVEL` | Optional | `4000`, `0.0.0.0`, `info`. |

The feed worker needs only `DATABASE_URL`.

### Built-in protection

- Rate limits per client address: 600 requests a minute overall; sign-in emails 20, code checks 40, and token refreshes 120 per 15 minutes. On top of these, 5 sign-in emails per email address per 15 minutes and 5 wrong codes per request. The counts are kept in memory, so each API instance counts separately until there's Redis.
- Security headers on every response (`nosniff`, no framing, a strict referrer policy) and HSTS over https.
- If the email provider fails, sign-in answers 503 with a "try again" message, and the error is logged.

## Web app

Build with the API's public address baked in:

```sh
cd apps/client
EXPO_PUBLIC_API_URL=https://api.example.com EXPO_PUBLIC_SHARE_URL=https://api.example.com \
  npx expo export --platform web --clear
```

Use `--clear`: Metro's cache can otherwise keep an earlier build's `EXPO_PUBLIC_*` values. Upload `dist/`.

The host must:

1. Serve files as they are, with clean URLs: `/settings` serves `settings.html`.
2. Rewrite the dynamic routes to their pre-rendered pages (a rewrite, not a redirect, so the address stays):
   - `/episode/*` → `/episode/[id].html`
   - `/podcast/*` → `/podcast/[id].html`
3. Answer anything else with `+not-found.html` and status 404.
4. Cache `/_expo/static/*` for a long time (the file names change with each build); keep HTML uncached or briefly cached.

`apps/e2e/src/serve-export.ts` implements exactly these rules, and `pnpm e2e:export` runs browser checks against a production build served that way: every page loads, deep links work, and no page fails hydration. Run it before changing hosting rules.

`EXPO_PUBLIC_SHARE_URL` is where shared episode links point: the API's `/s/e/:id` pages, which carry the link previews. Give it a short public domain if possible.

## Release checklist

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm e2e:export`, or a green CI run.
2. Build and push the server image; run `migrate` (or let the API do it).
3. Deploy the API, then the worker.
4. Build and upload the web app.
5. Check `/ready`, sign in with a real address (the email arrives), and open a shared link.

## Not yet done

- Redis: shared rate-limit counts across API instances, and caching.
- Error reporting (Sentry) and analytics.
- WebSub push for feeds (needs a public callback URL).
- EAS build profiles and store listings (need the Apple and Google accounts).
