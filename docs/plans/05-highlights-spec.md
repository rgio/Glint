# Highlights and notes: feature spec

> A snapshot of the [online spec](https://claude.ai/code/artifact/327993cb-107f-4d29-b1e0-945835601934) (revision 25), copied on 9 October 2026. The online doc stays the one to edit and comment on. This is the spec as written before building: phase 1 has since been built with these defaults, and highlights already sync between devices (phase 4) because accounts landed first. What was built, and where it differs, is in [04-status-and-todos.md](04-status-and-todos.md).

2 October 2026 · Rob

## Summary

Listeners can save the moment they just heard with one tap, without stopping playback or looking at the screen, and add a note later if they want. A highlight is a short time range in an episode, usually the last 30 seconds, plus whatever context we can attach: the transcript text, the chapter, and the listener's note.

The core problem is timing. By the time someone realises a passage was worth keeping, it has already played, and their hands may be busy (driving, running, cooking). So capture looks backwards from "now", takes one action, and never interrupts playback; refining the range and writing a note happen afterwards.

**Goals**

- Capture in one action from the player, the lock screen and the keyboard, without pausing.
- Every highlight can be replayed, edited, annotated and found again later, across devices.
- Highlights show the spoken words when the episode has a transcript.

**Non-goals for the first release**

- Generating transcripts or AI summaries ourselves (see Transcripts and context).
- Public social features: following, likes, a feed of other people's highlights.
- Clipping audio or video files for social media.

## How other apps do it

The closest model is Snipd: a headphone gesture saves the last minute or so without interrupting, and the transcript and context arrive afterwards. Pocket Casts proves the headphone trigger works for a mainstream app but saves only a point in time, with no note.

| App | What gets saved | How it's triggered | Notes and context | Review and export |
| --- | --- | --- | --- | --- |
| [Snipd](https://www.snipd.com/blog/how-to-take-notes-from-podcasts-with-snipd) | A range, "typically the last 60 seconds you heard", bounded by AI | In the player, or the headphones' skip-back gesture ([triple-press on AirPods Pro](https://support.snipd.com/en/articles/10225450-create-snips-with-your-headphones)), with a confirmation beep | Transcript, AI summary, speaker names, the listener's note, tags | A library of snips; exports to Notion, Obsidian and Readwise. AI features are limited on the free tier |
| [Pocket Casts bookmarks](https://support.pocketcasts.com/knowledge-base/bookmarks/) | A single timestamp, not a range | In the player, or headphone previous/next mapped to "Add bookmark" | No notes ("may be possible in the future") | Profile > Bookmarks; sharing gives a link that opens at the timestamp. Plus or Patron only |
| [Overcast clips](https://marco.org/2019/04/27/overcast-clip-sharing) | An audio or video clip up to 1 minute | The share sheet, trimmed by hand | None | Made for sharing to social media, not personal review |

What to take from them:

- **Look backwards from now.** Both Snipd and Pocket Casts capture what was just heard; nobody asks the listener to mark a start and an end in real time.
- **Use the headphones.** The skip-back or previous-track command is the one control every headset sends, so it's the most reliable hands-free trigger.
- **Confirm without looking.** Snipd's beep tells the listener the capture worked with the phone in a pocket.
- **Ranges, not points.** A point only lets you jump back; a range can show the words, be replayed as a unit, and be shared as a quote.
- **Notes are the gap.** Pocket Casts has none, and Snipd's value comes from what's attached to the audio. Ours should be easy to add later, not at capture time.

## Scenarios

Three situations drive the design: capture with busy hands, capture with a thought to add (typed or spoken), and coming back later to use what was saved.

1. **Hands busy.** Maya is running when a guest explains a training idea. She triple-presses her AirPods; a short tone confirms it. Playback never stops. That evening the highlight is waiting on the episode page with the guest's words, and she adds a note.
2. **A thought to add.** Dev is listening at his desk on the web app. He presses **H**, the highlight appears on the scrubber, and a note field opens beside the player without pausing. He types "try this on the onboarding flow" and carries on listening.
3. **Speaking a note.** Priya is driving when a guest recommends a book. She triple-presses her AirPods, hears the confirmation tone, and says "add this to the team reading list". Playback ducks while she talks and resumes when she stops (about two seconds of silence ends the note; if she says nothing, the highlight saves without one). Later she finds the highlight with her note transcribed as text, and the recording kept so she can replay it.
4. **Coming back later.** A week on, Dev opens Library > Highlights, searches "onboarding", and finds the note. Tapping it plays those 30 seconds. He nudges the start back 10 seconds to include the setup, then copies it as a quote with a link that opens the episode at that point.
5. **Ruling out the wrong moment.** Maya's capture caught the end of an ad break. She drags the start forward on the highlight, or deletes it with one swipe.

These map to the sections below: capture (1, 2, 3), review and editing (4, 5), and context from transcripts (1, 3, 4).

## Core concepts

A highlight is a range of an episode's audio, from a start to an end time in seconds, created by looking back from the moment of capture. Everything else (note, transcript text, chapter) hangs off that range.

**Choosing the range at capture**

- **End** = the playback position when the listener acts.
- **Start** = end minus the look-back, which defaults to 30 seconds (setting: 15, 30, 60 or 90).
- **Look-back counts listening time, not audio time.** People remember how long ago they heard something, so at 1.5x a 30-second look-back covers 45 seconds of audio.
- **Limits:** the start never goes below 0; a highlight is 3 seconds to 5 minutes long.
- **Snapping:** when there's a transcript, the start moves back to the beginning of the sentence it falls in, and the end moves forward to the end of the current sentence, by no more than 5 seconds. Without a transcript the range is used as captured.
- **Repeated presses:** a second capture within 10 seconds of the last one on the same episode extends that highlight rather than making a new one, so mashing the button doesn't create duplicates.

**What a highlight carries**

| Field | Source | Notes |
| --- | --- | --- |
| Episode and show | Player | Shows the highlight under its episode and show |
| Start and end | Capture, then editable | Seconds into the episode's audio |
| Note | Listener, optional | Plain text, up to 5,000 characters; added at capture or any time later |
| Transcript excerpt | Episode transcript, if any | The words in the range, stored with the highlight so it still reads if the transcript changes |
| Chapter | Episode chapters, if any | The chapter title at the start position |
| Anchors for relocation | Capture | Episode duration and enclosure URL at capture, plus the transcript excerpt |
| Capture source | Player | In-app, lock screen, headphones or keyboard, for metrics |

**Keeping highlights accurate when the audio changes**

Shows with dynamically inserted ads serve slightly different audio each time, so a saved position can drift; Pocket Casts warns about this in its bookmarks docs. We store the episode's duration and the transcript excerpt at capture. If a later playback has a different duration, we find the excerpt in the new transcript and move the range to match. Without a transcript we keep the original times and mark the highlight "position may have shifted".

## Capture

One action saves a highlight on every surface, playback keeps going, and the listener gets a confirmation they can notice without looking. The note is always optional and never blocks the capture.

| Surface | Trigger | Confirmation | Note entry |
| --- | --- | --- | --- |
| Full player | A **Highlight** button beside speed and sleep timer | A toast "Highlighted last 30 s" with **Add note** and **Undo**; a marker appears on the scrubber | Tapping **Add note** opens a field over the player; audio keeps playing |
| Mini player (web bar, Android bar, iOS accessory) | A highlight icon button | The same toast | **Add note** in the toast |
| Web keyboard | **H** | The same toast | **Shift+H** captures and opens the note field straight away |
| Headphones and media keys | Previous track (AirPods triple-press, wired-headset triple-click, keyboard ⏮), when the listener turns this on | A short tone through the audio, and a haptic on the phone | Spoken right after the tone (if spoken notes are on), or later from the episode page |
| Lock screen and car | A bookmark button on iOS; a custom notification button on Android | Tone and haptic | Spoken right after the tone (if spoken notes are on), or later |

**Details that matter**

- **Undo** removes the highlight for 5 seconds after capture.
- **The tone** is short and quiet, and mixed over the episode rather than pausing it.
- **The headphone mapping is opt-in.** Previous track normally means "skip back". Settings > Highlights > "Headphone previous-track button" offers Skip back (default) or Highlight, like Pocket Casts' headphone actions.
- **Capture works offline** and for downloaded episodes; it syncs later.
- **Capture while paused** uses the paused position as the end, so pausing and then highlighting works.
- **Writing a note never pauses playback.** The listener can pause from the note sheet if they want to.

**Spoken notes**

For hands-free capture (headphones, lock screen, car), the listener can say a note straight after the confirmation tone instead of typing one later.

- **Opt-in.** Settings > Highlights > "Speak a note after hands-free capture", off by default. The microphone permission is asked when the listener turns this on, never in the middle of a capture (they may be driving).
- **The listening window.** After the tone, the app listens for up to 3 seconds for speech to start. If none starts, the highlight saves without a note, so capture behaves exactly as it does with the setting off. Once speech starts, about 2 seconds of silence ends the note, with a hard limit of 60 seconds, and a second softer tone confirms it.
- **Playback ducks, it doesn't stop.** The episode drops to low volume while the mic is open and comes back when the note ends. Opening a Bluetooth headset's mic switches it to its call profile, which lowers audio quality for those seconds; ducking keeps that from being jarring. A setting to use the phone's mic instead is worth testing.
- **Transcribed on the device.** The note is turned into text with the phone's own on-device speech recognition (iOS and Android both offer it), so the recording isn't sent anywhere to be transcribed. The text becomes the highlight's note, editable like a typed one.
- **The recording is kept** with the highlight so the listener can replay it if the transcript got a word wrong. They can delete the recording and keep the text, or turn off "Keep recordings" so only the text is saved.
- **Failure never loses the highlight.** No permission, no speech, or recognition failing offline: the highlight still saves, and any recording is kept to transcribe later.
- **Phasing.** Spoken notes ship with hands-free capture (phase 3), since they need the same native audio work.

## Reviewing and editing

Highlights live in three places: on the episode they came from, on the scrubber while that episode plays, and in one list across all shows.

- **Episode page.** A Highlights section above the show notes lists the episode's highlights in time order. Each card shows the time range, the transcript excerpt (or "No transcript"), the chapter, and the note. A play button plays just that range, then stops.
- **Scrubber markers.** The full player's progress bar shades each highlighted range. Tapping a shaded range opens its card.
- **Library > Highlights.** Every highlight, newest first, grouped by episode. Search covers notes, transcript excerpts, episode titles and show names, and there's a filter for "has a note".
- **Editing a range.** On the card, **Adjust** shows a 2-minute strip around the range with draggable start and end handles, plus ±5-second nudge buttons for precision and for screen readers. Changing the range refreshes the transcript excerpt.
- **Editing a note.** Tap the note or **Add note** to edit it in place. Notes autosave.
- **Deleting.** Swipe left on mobile, or the card's menu on web; **Undo** is offered for 5 seconds.
- **Copy as quote.** Copies the excerpt (or the note when there's no transcript), the show and episode title, and a link that opens the episode at the start time. This reuses F-15 share links.
- **Export.** Library > Highlights > Export saves all highlights as Markdown, one section per episode. Readwise and Notion integrations are later work (see Phasing).

## Transcripts and context

Highlights work without transcripts, but they're far more useful with the words attached, and most feeds don't publish transcripts. The plan: use a publisher transcript when the feed has a timed one, and otherwise get one from the dLogos Partner Episode API, which we already have a key for and have tested on an episode of The Daily.

**How common publisher transcripts are.** A [June 2026 audit of 2,148 episodes across 8 AI podcasts](https://chainofthought.show/reports/state-of-ai-podcast-feeds-2026/) found only 8.8% carried a `podcast:transcript` tag, and five of the eight shows had none. That's a small, tech-heavy sample, so treat it as a sign that most highlights won't have publisher text, not as a market figure.

**Three levels of context**

1. **Timed publisher transcript** (`podcast:transcript` as SRT, WebVTT or JSON). Free, exact words, sentence boundaries for snapping. Plain-text or HTML transcripts have no timings, so they can't be matched to a range and are only linked.
2. **dLogos.** The server submits the episode, polls until it's ready, and caches the result. A test on 25 August 2026 (*The Daily*, "Canada Is Done With Trump", 37 minutes, saved in `data/dlogos/`) returned:
   - 156 timed segments, each with start and end in milliseconds, a speaker name and the text. Segments are utterances of about 10 to 18 seconds, not sentences.
   - Named speakers via a speaker map. Names are inferred and can be wrong: "Michael Bilbaro" for Michael Barbaro.
   - 9 chapters with start times, 3 "takeaways" with a start time and tags, and an empty claims list.
3. **No transcript yet, or none available.** The highlight shows its time range, the chapter title if known, and the note. The excerpt fills in when a transcript arrives, since the range is stored in seconds and the words can be looked up later.

**Work this needs**

- Store `transcriptUrl` and `chaptersUrl` per episode. The feed parser already extracts both (F-16 groundwork), but the catalog doesn't save them yet.
- A server-side transcript service: try the publisher transcript (SRT, WebVTT, Podcasting 2.0 JSON); otherwise request dLogos, cache the segments per episode in Postgres, and serve ranges from the cache.
- **When to request dLogos:** on the first highlight in an episode, not for every episode played. Processing is asynchronous (submit, then poll), so the excerpt appears on the highlight a little later. That's fine, because nobody reads a highlight's text the moment they capture it.
- **Snapping with dLogos segments:** snap to segment boundaries only when the segment edge is within 5 seconds of the captured edge. Otherwise keep the captured time, because segments can run 18 seconds or more.
- **Mapping our shows to dLogos:** the API identifies a show by dLogos' own podcast slug (`the-daily-a12f141d`) and an episode by its feed GUID or a slug. We need a way to find the slug from a feed URL. See the open questions.
- **Unknowns, because dLogos has no public docs** (`/docs` and similar return 404): pricing and quotas, processing time, which shows it covers, and whether we may display and cache transcripts in our app. Its response also carries chapters and takeaways that could serve F-16 and Discover later.

## Data, sync and API

A highlight is per-user state like a playback position: created on the device with its own ID, usable offline straight away, and synced through the same pull-based sync as everything else (F-13).

**`Highlight`**** (in ****`packages/shared`****)**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Made on the device, so offline captures never collide |
| `episodeId`, `podcastId` | string | Catalog IDs |
| `startSec`, `endSec` | number | 3 s ≤ length ≤ 300 s |
| `note` | string or null | Up to 5,000 characters |
| `transcriptExcerpt` | string or null | Filled in after capture when a transcript is available |
| `chapterTitle` | string or null | From chapters, if any |
| `anchor` | `{ durationSec, enclosureUrl }` | For relocating after the audio changes |
| `source` | `player`, `miniPlayer`, `keyboard`, `headphones`, `lockScreen` | For metrics |
| `createdAt`, `rangeUpdatedAt`, `noteUpdatedAt` | epoch ms | Separate edit times for the range and the note |
| `deleted` | boolean | A tombstone, so a deletion syncs |

**Conflict rules**

- **Field by field.** The range and the note each keep the newer edit, so changing the note on the web while nudging the range on the phone keeps both. This is the one place we go beyond whole-record last-write-wins, because the two halves are edited separately in practice.
- **Deletion wins** over any edit.
- **First sign-in** merges by ID. IDs are UUIDs, so this is a union with no clashes.

**Storage on the device**

A `highlights` store persisted like the player and library stores (IndexedDB on web, the SQLite key-value store on native). That's fine for hundreds of highlights. The sync outbox will move local data to real SQLite tables (Drizzle) anyway, and highlights move with it.

**API additions**

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/sync`, `GET /v1/sync` | Highlights ride the general sync as a new change type |
| `GET /v1/me/highlights?q=&cursor=` | Server-side list and search, for the web before local data loads |
| `GET /v1/episodes/{id}/transcript?start=&end=` | The words in a range, from the cached publisher or dLogos transcript |
| `GET /v1/episodes/{id}/transcript/status` | Whether a transcript is cached, pending at dLogos, or unavailable, so the app knows when to refresh excerpts |

Accounts and sync aren't built yet. Until they are, highlights are stored on the device only, like everything else today.

## Platform constraints

Hands-free capture on iOS and Android is blocked by our current audio library, so it needs an audio-stack decision before it can ship. In-app and web capture have no such blocker.

**What expo-audio does today** (version 57.0.5, read from its source)

- **iOS:** it registers play, pause, scrubbing and skip back/forward on the system's remote command centre, and performs the skips itself (fixed 10-second jumps). It never tells our JavaScript a skip happened, and doesn't register previous-track or bookmark commands at all.
- **Android:** the media session handles seek back/forward natively, explicitly removes previous/next, and sends nothing to JavaScript.
- **So:** with expo-audio we can't turn a headphone press or a lock-screen button into a highlight. We'd only see that the position jumped.

**Options**

| Option | Hands-free capture | Cost and risk |
| --- | --- | --- |
| A. Move native playback to react-native-track-player 4.1.2 | Yes. It sends previous-track and jump-back events to JavaScript on both platforms, plus a bookmark event on iOS (checked in its published types) | Replaces `audio-player.native.ts` behind the existing `AudioPlayer` interface; needs a development build (no Expo Go). This is the library the spec first chose |
| B. Our own Expo module beside expo-audio | Yes, but it fights expo-audio for the same system controls | A native module to maintain on two platforms, which breaks if expo-audio changes how it registers commands |
| C. Stay on expo-audio and ship in-app capture only | No | None now; leaves out the scenario where highlights matter most |

**Recommendation:** option A. It unblocks highlights and resolves the open "stay on expo-audio?" question from the status doc in the same move. Ship in-app and web capture first (they don't depend on it), and do the switch before the hands-free phase.

**Per platform once that's done**

- **iOS:** headphone triple-press sends previous track (or skip back, depending on what's registered); the lock screen can show a bookmark control. CarPlay is P2 (F-25).
- **Android:** headset previous-track works the same way, and the media notification can carry a custom Highlight button.
- **Web:** we own the Media Session handlers in `audio-player.web.ts`, so mapping `previoustrack` to Highlight works today when the setting is on. Keyboard **H** works whenever the app has focus.
- **Confirmation tone:** played through the same audio session so it reaches headphones. Each platform needs testing so it doesn't duck or pause the episode.

## Accessibility, privacy and sharing

Highlights are private by default; the only thing that ever leaves the listener's account is a quote they choose to copy or share.

**Accessibility**

- The Highlight button has a spoken label ("Highlight the last 30 seconds"), and the toast is announced, so screen-reader users get the same confirmation as the tone.
- Range adjustment works without dragging: ±5-second buttons for each end, and the range read out as "from 12:04 to 12:34".
- Scrubber markers have a text equivalent: the episode page lists every highlight.
- The tone respects the system's sound settings, and the haptic respects reduced-haptics settings.

**Privacy**

- Highlights and notes are user data like positions: stored on the device, and in the listener's account once sync exists, never shown to anyone else.
- Requests to dLogos carry only public identifiers (the show's slug and the episode's GUID), never the listener's identity, highlights or notes, and they're made from our server, not the device.
- Spoken notes use the microphone only during the listening window after a hands-free capture, with the system's mic indicator showing. Transcription runs on the device, and recordings are stored like notes (on the device, then in the listener's account), deletable on their own.
- Aggregate stats ("most-highlighted moments in this episode") are attractive but are a separate decision with its own consent. They're out of scope here and listed as an open question.

**Sharing**

- **Copy as quote** (above) is the only sharing in the first release: text plus a link that opens the episode at the start time.
- The link uses F-15's public episode pages with a time parameter. The page shows the quote only if the listener chose to include it, never their note unless they pasted it.
- Audio or video clip export, as in Overcast, is out of scope until there's demand.

## Phasing

Ship in-app capture and review first: it depends on nothing we haven't built, and it shows whether listeners use highlights before we spend on transcripts and an audio-stack switch.

*The online doc has a diagram of the four phases and the gate each waits on; the table below holds the same information.*

Phase 1 needs no accounts: highlights stay on the device, like positions do today. Each later phase waits on its own gate (dLogos terms, the phone audio test, accounts and sync) rather than on the others, so they can be ordered by whichever gate clears first.

| Phase | Rough size | Depends on |
| --- | --- | --- |
| 1. Capture and review | About 2 weeks | Nothing new; copy-as-quote links reuse the episode page |
| 2. Words attached | About 2 weeks | dLogos pricing, terms and slug lookup confirmed |
| 3. Hands-free capture | About 3 weeks | Switching native audio to react-native-track-player, tested on real phones |
| 4. Across devices | About 1 week on top of sync | Accounts and sync (F-12, F-13) |

Sizes are one developer's rough estimates, to compare the phases, not commitments.

## Success metrics

The question for phase 1 is whether people come back to their highlights, not just whether they make them. Targets get set after two weeks of dogfood data; these are what we measure.

| Metric | What it tells us | Captured from |
| --- | --- | --- |
| Share of weekly listeners who make at least one highlight | Whether the feature is found and wanted | `Highlight.createdAt` |
| Highlights revisited within 7 days (played, edited, noted or copied) | Whether highlights are worth keeping, which matters more than volume | Highlight events |
| Share of highlights with a note | Whether note entry is easy enough | `note` |
| Highlights undone or deleted within 1 minute | Accidental or wrongly placed captures | Undo and delete events |
| Range adjusted after capture | Whether the 30-second default is right | `rangeUpdatedAt` after `createdAt` |
| Capture source mix | Which surfaces matter, and whether phase 3 is worth it | `source` |
| Excerpt available rate (phase 2) | How much publisher transcripts and dLogos actually cover | Transcript service |

Analytics needs listener consent and isn't built yet (status doc: Sentry and analytics not started). Until then, these are read from local data during dogfooding.

## Open questions

The first two decide whether phases 2 and 3 can start; the rest can be settled during phase 1.

- [ ] **Audio stack:** switch native playback to react-native-track-player (recommended, needed for hands-free capture), or stay on expo-audio and ship in-app capture only?
- [ ] **dLogos:** what are pricing and quotas, typical processing time, and show coverage? May we cache and display its transcripts in our app? Is there a lookup from feed URL to dLogos podcast slug, or do we keep our own mapping?
- [ ] **Default look-back:** 30 seconds (Pocket Casts-style quick capture) or 60 (Snipd's "last 60 seconds you heard")? The metrics will tell us later; this sets the starting point.
- [ ] **Headphone mapping:** keep previous-track as "skip back" by default, with Highlight opt-in (recommended), or make Highlight the default for new users?
- [ ] **Paid or free:** Pocket Casts puts bookmarks behind Plus, and Snipd limits its AI features on the free tier. Is capture free, with dLogos excerpts as the paid part? This ties to the open business-model question in the main spec.
- [ ] **AI summaries:** dLogos already returns takeaways. Do we want a one-line AI summary per highlight later, Snipd-style, or keep highlights to the listener's own words?
- [ ] **Aggregate "popular moments":** ever show the most-highlighted parts of an episode? It needs consent and a privacy review, so it stays out of this spec unless you want it.

## Sources

- [Snipd: how to take notes from podcasts](https://www.snipd.com/blog/how-to-take-notes-from-podcasts-with-snipd)
- [Snipd: create snips with your headphones](https://support.snipd.com/en/articles/10225450-create-snips-with-your-headphones)
- [Pocket Casts: bookmarks](https://support.pocketcasts.com/knowledge-base/bookmarks/)
- [Marco Arment: clip sharing with Overcast](https://marco.org/2019/04/27/overcast-clip-sharing) (April 2019)
- [Chain of Thought: the state of AI podcast feeds, 2026](https://chainofthought.show/reports/state-of-ai-podcast-feeds-2026/)
- expo-audio 57.0.5 and react-native-track-player 4.1.2: read from their published source and types
- dLogos Partner Episode API: `dlogos_test.py` and its saved response in `podcast_test/data/dlogos/` (no public docs)

