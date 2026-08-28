# QR Emergency Help

This repo contains the QR emergency help frontend plus a local Node.js backend for push alerts.

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

## Push alerts

- The frontend registers responder browsers with Firebase Cloud Messaging
- The local backend stores responder tokens in `data/responders.json`
- Alerts are sent from the backend through Firebase Admin SDK

## Local backend

1. Install dependencies once with `npm install`.
2. Put your Firebase service account JSON file somewhere local, for example `firebase-service-account.json` in the project root.
3. Copy `.env.example` to `.env` and fill in:
   - `FIREBASE_SERVICE_ACCOUNT_PATH`
   - `PORT`
   - `ALLOWED_ORIGIN` (use the GitHub Pages origin, not the page path)
4. Start the backend:

```bash
npm start
```

The server listens on `http://localhost:<PORT>` and exposes:

- `POST /api/register`
- `POST /api/alert`
- `GET /health`

## Tunnel for field testing

Use `ngrok` to expose the local backend temporarily:

```bash
ngrok http 3000
```

Copy the generated HTTPS forwarding URL and use it as `API_BASE_URL` in `public/firebase-config.js`, ending with `/api`.

## GitHub Pages setup

- Host the frontend from the `dist/` folder produced by `npm run build`
- Set `public/firebase-config.js` to your Firebase web config
- Put your Firebase Cloud Messaging VAPID key in `public/firebase-config.js`
- Set `API_BASE_URL` in `public/firebase-config.js` to your backend URL, for example `https://YOUR-NGROK-URL/api`

## What the responder does

- Opens `https://YOUR_GITHUB_PAGES_SITE/#/register`
- Enters a short device label
- Taps `Enable notifications`
- Approves the browser notification prompt
- Leaves that browser/device registered for future alerts

## What to edit

- Update recipient numbers, message template, and locations in `data/locations.json`
- Update Firebase config values in `public/firebase-config.js`
- Update the backend service account path in `.env`
- Add or change responder devices by opening `#/register` on each device



