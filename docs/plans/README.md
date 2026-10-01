# Plans

Everything planned and decided in the 2026-10-01 Claude Code session that specced and started building this app, captured so work can continue anywhere.

| File | What's in it |
| --- | --- |
| [01-product-spec.md](01-product-spec.md) | Full product and technical spec: goals, stack, the F-01 to F-27 feature table, audio engine, architecture, data model + REST API, UX, non-functional requirements, testing/CI, roadmap, risks |
| [02-v1-scope-decisions.md](02-v1-scope-decisions.md) | What Rob decided: Expo, v1 cuts, push and car support at P2, repo location, Node backend |
| [03-implementation-plan.md](03-implementation-plan.md) | How the code is laid out, where it differs from the spec (notably `expo-audio` instead of track-player, and no local DB yet), and what was verified |
| [04-status-and-todos.md](04-status-and-todos.md) | Every P0 feature and infra item marked done / partial / not started, the suggested next steps, and open questions |

## Where things stand

A local vertical slice works: paste an RSS URL, open the show, play, queue and resume, on iOS, Android and web from one codebase, against an in-memory Fastify API. Nothing is persisted yet, and accounts, sync, search, discovery, downloads and the sleep timer are not started. See [04-status-and-todos.md](04-status-and-todos.md).

## Run it

```sh
pnpm install
pnpm dev:api        # Fastify on :4000
pnpm dev:client     # Expo; press w for web, i for iOS, a for Android
pnpm test && pnpm typecheck
```

## Source of truth

The living spec is a Claude Doc: https://claude.ai/code/artifact/87e6afa3-a9ab-49ce-9d09-11f69cb6ad30. `01-product-spec.md` is a snapshot of revision 24. Update the status file as features land.
