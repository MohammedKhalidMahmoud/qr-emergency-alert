# QR Emergency Help

This repo now contains both tracks:

- Track 1: SMS QR generation
- Track 2: public help page + Firebase push notifications

## Track 1

- Reads `data/locations.json`
- Builds `sms:` deep links for the configured recipients
- Uses the `qrcode` package to create the QR matrix
- Generates PNG QR codes into `out/sms`
- Writes a JSON manifest to `out/sms-manifest.json`

Run it with:

```bash
npm run generate:sms
```

## Track 2

- Public help page lives at `#/help/:locationId`
- Responder registration lives at `#/register`
- Push tokens are stored through the Firebase Functions API
- Help alerts are broadcast to every registered responder

## GitHub Pages setup

- Host the frontend from the `dist/` folder produced by `npm run build`
- Deploy the backend separately with Firebase Functions
- Set `public/firebase-config.js` to your Firebase web config
- Put your Firebase Cloud Messaging VAPID key in `public/firebase-config.js`
- Set `apiBaseUrl` in `public/firebase-config.js` to your Functions endpoint, for example `https://us-central1-YOUR_PROJECT.cloudfunctions.net/api`

## What the responder does

- Opens `https://YOUR_GITHUB_PAGES_SITE/#/register`
- Enters a short device label
- Taps `Enable notifications`
- Approves the browser notification prompt
- Leaves that browser/device registered for future alerts

## What to edit

- Update recipient numbers, message template, and locations in `data/locations.json`
- Update Firebase config values in `public/firebase-config.js`
- Update the backend Functions project ID before deployment
- Add or change responder devices by opening `#/register` on each device
