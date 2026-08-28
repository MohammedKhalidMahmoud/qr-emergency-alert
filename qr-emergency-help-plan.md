# QR-Based Emergency Help Request — Project Plan

## Goal
Let someone in a low-network-coverage area request help by scanning a QR code, without relying on a phone call to an emergency center. Solo developer, zero budget.

## Core constraint driving every decision
Bad coverage areas often have enough signal for SMS (which rides the cellular *control channel*, needing very weak signal) but not enough for calls or data (which need the *traffic/data channel*, a stronger and more stable signal). Any solution that depends on loading a webpage or sending data traffic reintroduces the exact fragility this project exists to avoid. This is why the project runs two parallel tracks instead of one.

## Track 1 — SMS (primary, coverage-resilient)

**Flow:** QR encodes an `sms:` deep link with the phone number(s) and a pre-filled message body containing a location name. Scanning opens the phone's native Messages app pre-composed; the user taps send. No app, no server, no HTTP request involved — the OS handles the `sms:` URI directly.

**Why it fits the constraint:** SMS uses the cellular control channel, which needs far less signal strength than a data connection or voice call. It's also store-and-forward — if it can't send immediately, the phone retries in the background.

**Multi-recipient decision:** The caller's device will send directly to multiple numbers at once (your preference), accepting the trade-offs below rather than relaying through a single dispatcher phone.

**Known limitations to document, not fix (out of your control):**
- Whether a multi-recipient `sms:` link sends as separate plain SMS messages or upgrades to a group MMS/iMessage thread depends on the *sending phone's own settings* (Android: "group messaging" toggle; iOS: default group behavior). Group MMS/iMessage rides the data channel, which defeats the purpose — this can't be forced from the QR code side.
- Keep the recipient list short (2-3 numbers max) — longer lists increase the odds a phone defaults to grouping.
- Every responder's phone number is embedded in plaintext in a public, physically-placed QR code. Adding/removing a responder means regenerating and reprinting that QR.
- No delivery confirmation or partial-failure feedback to the sender.

**Components needed:** Just the QR code itself. No backend.

## Track 2 — Push notification (comparison / secondary)

**Flow:** QR encodes an `https:` link → opens browser → HTTP request to a small backend endpoint → endpoint triggers Firebase Cloud Messaging (FCM) → registered responder devices receive a push notification.

**Why it's being tested in parallel:** Push naturally supports fanning out to many devices (your responders: multiple phones + one tablet) in a way SMS doesn't cleanly support. The trade-off is that this entire path depends on the *requestor* having a working data connection to complete the initial HTTP request — the same fragility SMS avoids.

**Components needed:**
- Firebase project (free Spark tier)
- One Cloud Function (or equivalent free serverless function) that receives the GET/POST from the QR scan and calls FCM
- FCM set up to deliver to registered device tokens
- A responder-side app that registers for a device token and displays incoming alerts (location name + timestamp)

**Budget flag:** If any responder device is an iPhone, normally distributing an installable native app requires the $99/year Apple Developer Program. Two free workarounds while responder OS is still undecided:
- Run the responder app via **Expo Go** (free) for development/testing on real iPhones
- Build the responder side as a **PWA** instead of native — free on both platforms, though iOS web push requires iOS 16.4+ and the page to be added to the home screen first

Decide native vs. PWA once responder devices' actual OS is confirmed.

## Shared: Location identification scheme

Each physical QR location gets a short ID plus a human-readable name, stored in a simple mapping file (JSON or spreadsheet is sufficient at this scale):

```json
{ "LOC-NTB01": "North Trail Bench", "LOC-RVX02": "River Crossing" }
```

Both the SMS body and the push payload carry the short ID; the mapping file resolves it to the descriptive name for display.

## Recommended free-tier stack

| Component | Tool |
|---|---|
| QR generation | `qrcode` (Python) or `qrcode.js` — generates both `sms:` and `https:` payload types |
| Push backend | Firebase Cloud Functions (free Spark plan) |
| Push delivery | Firebase Cloud Messaging (FCM) — free, covers Android and iOS |
| Responder app | Expo (React Native) or PWA — decide once OS is known |
| Location mapping | JSON file or spreadsheet |

## Build phases

1. **QR generator** — script that takes a location name, produces both the SMS-track QR and the push-track QR, and logs the ID mapping.
2. **SMS track** — no backend code; verify behavior on real Android and iOS phones (default settings).
3. **Push track backend** — Firebase project + one Cloud Function receiving the scan request and calling FCM.
4. **Responder app/PWA** — minimal UI: register FCM token, list incoming alerts with location name and timestamp.
5. **Real-world field test** — physically place both QR types at an actual low-coverage location.

## Field test protocol

For each test attempt, log:
- Signal bars at scan time (if visible on the phone)
- Time from scan to SMS "sent" confirmation vs. time to push notification arrival
- Whether the SMS stayed as individual messages or became a group MMS/iMessage thread (check the phone's own message log)
- Any failure and the exact step it occurred at

Test with both an Android and an iPhone if possible, using default (unmodified) phone settings, since that reflects what a real requestor's phone would look like in an emergency.

## Open decisions still to make

- Final responder device OS mix (affects native vs. PWA choice for Track 2)
- Exact phone numbers for the SMS track
- Final list of physical locations and their descriptive names
