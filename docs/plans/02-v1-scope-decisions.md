# v1 scope decisions

Decisions Rob made in the planning session on 2026-10-01, in order. The spec
([01-product-spec.md](01-product-spec.md)) already reflects all of them.

## 1. Framework: React Native + Expo

- Chosen over Flutter, Kotlin Multiplatform and Capacitor, mainly for real-DOM web output (accessibility, SEO for public show pages, normal URLs).
- Rob confirmed: "RN with expo is great."

## 2. v1 feature cuts

The aim: a v1 that does the core job well (find a show, play it reliably, never lose your place). The proposal Rob accepted:

**Kept as is**
- Search and subscribe, including OPML import and export.
- Playback, queue, resume and played state.
- Downloads on mobile.
- Sleep timer.

**Kept, but simplified**
- **Sync:** dropped the 5-second real-time target (silent push + WebSockets). Sync runs on app launch, on return to foreground, on pause, and every 60 s during playback.
- **Signed-out mode:** simple merge on sign-in. Subscriptions are combined, and the furthest position and any played mark win. No field-level conflict handling.
- **Downloads:** manual download, auto-download latest episode, Wi-Fi-only, auto-delete after played. No storage-limit settings screen.
- **Discovery:** Podcast Index trending lists and categories only, with no editor picks.

**Moved to v1.x (P1)**
- Chapters and transcripts, bundled with the Podcasting 2.0 work.
- Per-show speed overrides (v1 has one global speed).
- Editorial curation.

**Pulled into v1**
- Sharing an episode link (F-15), without timestamp clips. It's cheap because the web app already serves show pages.

## 3. Push notifications and car support

- Rob: "Push notifications are out, CarPlay and Android auto out."
- Push is replaced in v1 by a Home **"New"** section showing new episodes since the last visit (F-11).
- Rob then said to **keep both at P2** (no date), not P1: F-24 push notifications, F-25 CarPlay / Android Auto.

## 4. Effect on schedule

The roadmap estimate went from about 24 to about 20 weeks. That figure is a rough guess, not a worked plan.

## 5. Implementation-time decisions

These came from the "let's start implementing" step. See [03-implementation-plan.md](03-implementation-plan.md).

- **Location:** the monorepo lives in a subfolder of the existing project, `podcast_test/podcast-app`, next to the existing Python ingest code. Rob chose this over a new sibling folder.
- **Backend language:** Node.js, per the spec. The existing Python feed parser (`podcast_ingest`) is **not** reused. Rob chose "Node, per spec."
