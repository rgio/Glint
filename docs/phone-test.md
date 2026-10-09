# Phone test walkthrough

The first run of the app on a real phone. So far everything has been checked in a web browser only. This test answers the questions only a phone can: does audio keep playing with the screen locked, do the lock screen and headphone controls work, and does the app feel right in the hand.

Allow about 45 minutes: 10 to set up, 30 to test, a few to write up. You need your Mac, your phone on the **same Wi-Fi** as the Mac, and headphones (wired or Bluetooth).

## 1. Before you start

**Node.** Check that the Mac has a current Node.js:

```sh
node -v
```

You need v20 or newer. If it prints an older version (on 9 October it printed v14, from a 2021 install, because Homebrew's Node had been removed) or "command not found", install it and open a new terminal:

```sh
brew install node
```

**Expo Go.** Install **Expo Go** on the phone from the App Store or Google Play. It runs the app without building it. If Expo Go later says the project needs a newer or older SDK, update Expo Go; the project uses Expo SDK 57.

**Your Mac's address.** The phone reaches the Mac's servers by its Wi-Fi address:

```sh
ipconfig getifaddr en0
```

It prints something like `10.0.0.33`. The steps below use `<MAC-IP>`; put this value in its place.

## 2. Start the servers

Open three terminal windows, each in `podcast-app/`. Leave all three running for the whole test.

**Terminal 1, the API:**

```sh
pnpm dev:api
```

Wait for `Server listening at http://<MAC-IP>:4000`.

**Terminal 2, the feed worker** (keeps shows up to date):

```sh
pnpm dev:worker
```

**Terminal 3, the app**, pointed at your Mac instead of `localhost` (on the phone, `localhost` means the phone itself):

```sh
cd apps/client
EXPO_PUBLIC_API_URL=http://<MAC-IP>:4000 pnpm exec expo start --clear
```

`--clear` makes sure the address is baked into this build. A QR code appears.

If a terminal says the port is already in use (`EADDRINUSE`, or Expo offers another port), an older server is still running. Stop it and start again:

```sh
lsof -ti tcp:4000 | xargs kill   # the API
lsof -ti tcp:8081 | xargs kill   # the app
```

**Check the phone can reach the API.** In the phone's browser, open `http://<MAC-IP>:4000/health`. It should show `{"ok":true}`. If it doesn't load, see Troubleshooting before going further; the app won't work either.

## 3. Open the app

- **iPhone:** point the Camera app at the QR code and tap the banner.
- **Android:** open Expo Go and tap *Scan QR code*.

The first load takes up to a minute while the Mac builds the app. Then you should see the Home tab.

Useful while testing:

- **Shake the phone** to open the developer menu: *Reload* restarts the app, which is handy after a crash.
- **Terminal 3** shows the app's logs and errors as they happen.
- **Terminal 1** shows each request to the API, and the sign-in code when you sign in.

## 4. The test

Work through these in order; later steps use what earlier ones set up. Tick each one, and note anything odd, even small (see section 5 for what to write down).

### A. Find and subscribe (3 min)

- [ ] **Discover** shows a Trending list and category chips. Tap a chip; the list changes.
- [ ] **Search** for a show you know. Results appear as you type.
- [ ] Open a show and tap **Subscribe**. It appears under **Library**.
- [ ] Back on **Home**, its newest episodes are listed.
- [ ] **Layout:** nothing is cut off by the notch, the home indicator or the tab bar. Switch the phone to **dark mode** and back; the app follows.

### B. Playback (5 min)

- [ ] Play an episode. Audio starts within a few seconds, and the **player bar** appears above the tabs (on iPhone it may sit on the tab bar itself).
- [ ] Tap the player bar to open the **full player**. Artwork, title and times show.
- [ ] **Seek:** tap somewhere on the full player's progress bar, then drag it. Do the same on the player bar's progress line. Both should be easy to hit with a thumb.
- [ ] **Skip** back and forward. The labels match the amounts (15 s back, 30 s forward by default).
- [ ] **Speed:** tap the speed button (1x). Use − and + and a preset. Phones stop at 2x; that's expected with the current audio library.
- [ ] **Settings → Playback:** change Skip back to 10 s. The full player's button now says 10 seconds.

### C. Locked screen, lock-screen controls and headphones (10 min)

The most important part of the test.

- [ ] Start playing, then **lock the phone**. Wait **5 minutes**. Is it still playing?
- [ ] On the **lock screen**: title and artwork show; play, pause and skip work.
- [ ] **Control Centre** (iPhone) or the **notification shade** (Android): the same controls are there and work.
- [ ] Switch to another app (say, Messages) for a minute. Audio keeps going, and coming back to the podcast app shows the right position.
- [ ] **Headphones:** play and pause with the headphone button or AirPods squeeze/tap.
- [ ] **Unplug or disconnect** the headphones while playing. Playback should pause, not blast from the speaker.
- [ ] **Phone call or Siri:** if you can, trigger Siri or have someone call. Playback pauses, and ideally resumes after.

If audio stops when the phone locks, note it but don't treat it as the final answer yet: Expo Go may not carry this app's own background-audio setting. A development build settles it (see "If background audio fails" below).

### D. Sleep timer (7 min, mostly waiting)

- [ ] In the full player, tap **Sleep timer → 5 min**. A countdown shows.
- [ ] Lock the phone. Over the last 10 seconds the audio should **fade out**, then stop.
- [ ] Set **End of episode** on an episode near its end (seek to the last minute). It should stop at the end, not start the next queued episode.

### E. Resume (2 min)

- [ ] Play something for a minute, then **force-quit** the app (swipe it away in the app switcher).
- [ ] Reopen it from Expo Go. The same episode is in the player bar at the same position. Press play: it carries on from there.

### F. Highlights (5 min)

- [ ] While playing, tap **Highlight** in the full player. A message shows "Highlighted 1:02–1:32" (or similar) with **Add note** and **Undo**.
- [ ] Tap **Add note**, type a sentence, **Save**. Audio keeps playing the whole time.
- [ ] Tap the highlight icon in the **player bar** too.
- [ ] The progress bar shows shaded marks where the highlights are.
- [ ] Open the episode page (from the show's episode list). Its **Highlights** section lists both. Tap **Play highlight**: it plays just that stretch and stops.
- [ ] **Share quote** opens the system share sheet with the quote and a link.
- [ ] **Library → Highlights** lists them; search finds your note.

### G. Sharing and OPML (3 min)

- [ ] On an episode page, tap **Share**. The system share sheet opens with a link. (The link points at your Mac, so it only opens on this Wi-Fi; that's fine for now.)
- [ ] **Library → Export OPML** opens the share sheet with a file. Save it to Files (iPhone) or Drive (Android).
- [ ] **Library → Import OPML**, pick that file. It reports the shows as already subscribed, without errors. If you have an OPML export from another podcast app, try that too.

### H. Sign-in and sync (5 min)

- [ ] **Library → Settings**, enter your email, tap **Email me a sign-in code**.
- [ ] No email is sent in development: the **6-digit code appears in Terminal 1**. Type it in. (The link in that log line points at the web app on your Mac, so use the code on the phone.)
- [ ] It says "Signed in as …" and "Synced at …".
- [ ] Force-quit and reopen the app. Still signed in.
- [ ] On the Mac, open `http://localhost:8081` in a browser and sign in with the same email (the new code shows in Terminal 1). Your subscriptions and highlights from the phone appear.
- [ ] Pause an episode on the phone; on the Mac, refresh or tap **Sync now** in Settings. The Mac shows the same position.

## 5. What to send me

For anything that didn't behave, a short note is enough:

- **Phone and system:** e.g. "iPhone 15, iOS 26.0" or "Pixel 8, Android 16".
- **Step:** e.g. "C, lock screen".
- **What happened** and what you expected.
- A **screenshot or screen recording** if it's visual.
- If the app showed a **red or yellow error screen**, the first few lines of its text, or a photo of it. Terminal 3 usually has the same error; copy it from there.

Paste them in chat, or add them to `TODO.md`. Also note what worked well: it tells me what not to touch.

## Troubleshooting

**The phone can't open `http://<MAC-IP>:4000/health`.**
- The phone and the Mac must be on the same Wi-Fi. Guest networks and some office networks block devices from reaching each other; a home network or the Mac's personal hotspot works.
- macOS may be blocking incoming connections: System Settings → Network → Firewall. Allow incoming connections for `node`, or turn the firewall off for the test.
- Your Mac's address may have changed (after a restart or moving networks). Run `ipconfig getifaddr en0` again and restart Terminal 3 with the new address.

**The app opens but says "Could not reach the server".** Same causes as above. Also check Terminal 3 was started with `EXPO_PUBLIC_API_URL=http://<MAC-IP>:4000` (not `localhost`), and with `--clear`.

**Expo Go says the project is incompatible.** Update Expo Go from the store. If it's already current and still refuses, tell me the SDK versions it names.

**The QR code doesn't open anything.** In Terminal 3, press `s` to switch to Expo Go mode if it says "development build", or type the `exp://` address it shows into Expo Go by hand.

**The app is stuck or shows an old version.** Shake the phone → Reload. If that doesn't help, stop Terminal 3 (Ctrl+C) and start it again with `--clear`.

### If background audio fails

Expo Go is a general-purpose app; some settings in this app's configuration (`app.json`), such as permission to play audio in the background, may only apply in the app's own build. To check, make a **development build**, the app with its own settings but the same live-reloading setup:

```sh
cd apps/client
pnpm dlx eas-cli@latest build --profile development --platform ios   # or android
```

This builds in Expo's cloud. It needs a free Expo account (it asks you to sign in), and for iPhone an Apple Developer account to install on your device. Android builds install directly from the download link. Tell me before you start, and I'll set up the build profile it needs.
