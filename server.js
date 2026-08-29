const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const ngrok = require('@ngrok/ngrok');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const SERVICE_ACCOUNT_PATH = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
const RESPONDER_TOPIC = 'responders';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const RESPONDERS_FILE = path.join(DATA_DIR, 'responders.json');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');

if (!SERVICE_ACCOUNT_PATH) {
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH in your .env file.');
}

const serviceAccount = loadServiceAccount(SERVICE_ACCOUNT_PATH);
const firebaseApp = initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore(firebaseApp);
const messaging = getMessaging(firebaseApp);
const responders = db.collection('responders');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(corsMiddleware);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'qr-emergency-alert-backend' });
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'qr-emergency-alert-backend' });
});

app.post('/api/register', async (req, res) => {
  try {
    const body = readRequestBody(req);
    const token = normalizeText(body.token || body.registrationToken, 4096);

    if (!token) {
      res.status(400).json({ ok: false, error: 'token is required.' });
      return;
    }

    const deviceName = normalizeText(body.deviceName, 80) || 'Unknown device';
    const userAgent = normalizeText(body.userAgent, 240);
    const platform = normalizeText(body.platform, 120);
    const now = new Date().toISOString();
    const tokenId = hashToken(token);

    await responders.doc(tokenId).set(
      {
        token,
        deviceName,
        userAgent,
        platform,
        active: true,
        topic: RESPONDER_TOPIC,
        topicSubscribed: false,
        createdAt: now,
        updatedAt: now,
        lastRegisteredAt: now,
        lastError: ''
      },
      { merge: true }
    );

    let topicSubscribed = true;
    let topicError = '';

    try {
      await messaging.subscribeToTopic([token], RESPONDER_TOPIC);
    } catch (error) {
      topicSubscribed = false;
      topicError = error?.message || 'Topic subscription failed.';
    }

    await responders.doc(tokenId).set(
      {
        topicSubscribed,
        lastError: topicError,
        updatedAt: now
      },
      { merge: true }
    );

    const snapshot = await responders.get();

    res.status(200).json({
      ok: true,
      deviceName,
      topicSubscribed,
      responderCount: snapshot.size
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to register responder.'
    });
  }
});

app.post('/api/alert', handleAlertRequest);
app.get('/api/alert', handleAlertRequest);
app.post('/api/alert/:locationId', handleAlertRequest);
app.get('/api/alert/:locationId', handleAlertRequest);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(PORT, async () => {
  console.log(`QR emergency alert backend listening on http://localhost:${PORT}`);
  await startNgrokForward();
});

async function startNgrokForward() {
  const domain = process.env.NGROK_DOMAIN?.trim();

  if (!process.env.NGROK_AUTHTOKEN) {
    console.log('NGROK_AUTHTOKEN not set. Skipping ngrok tunnel.');
    return;
  }

  try {
    const forwarder = await ngrok.forward({
      addr: `localhost:${PORT}`,
      authtoken_from_env: true,
      ...(domain ? { domain } : {})
    });

    console.log(`Ngrok forwarding available at: ${forwarder.url()}`);
  } catch (error) {
    console.warn('Ngrok tunnel failed to start:', error?.message || error);
  }
}

async function handleAlertRequest(req, res) {
  try {
    const body = readRequestBody(req);
    const locationId = normalizeText(
      body.locationId || body.loc || req.params.locationId || req.query.locationId || req.query.loc,
      80
    );

    if (!locationId) {
      res.status(400).json({ ok: false, error: 'locationId is required.' });
      return;
    }

    const locationName = (await readLocationName(locationId)) || locationId;
    const sentAt = new Date().toISOString();
    const readableTime = new Date(sentAt).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    const snapshot = await responders.where('active', '==', true).get();
    const activeResponders = snapshot.docs
      .map((document) => ({
        id: document.id,
        ref: document.ref,
        ...document.data()
      }))
      .filter((entry) => normalizeText(entry.token, 4096));

    if (!activeResponders.length) {
      res.status(409).json({ ok: false, error: 'No responders are registered yet.' });
      return;
    }

    const message = {
      notification: {
        title: 'Emergency help request',
        body: `${locationName} • ${readableTime}`
      },
      data: {
        locationId,
        locationName,
        sentAt,
        href: `/#/help/${encodeURIComponent(locationId)}`
      }
    };

    try {
      const messageId = await messaging.send({
        topic: RESPONDER_TOPIC,
        ...message
      });

      res.status(200).json({
        ok: true,
        strategy: 'topic',
        messageId,
        locationId,
        locationName,
        sentAt,
        responderCount: activeResponders.length,
        delivered: activeResponders.length,
        failed: 0
      });
      return;
    } catch (topicError) {
      console.warn('Topic send failed, falling back to stored tokens:', topicError?.message || topicError);
    }

    let delivered = 0;
    let failed = 0;
    const nextResponders = [];

    for (const responder of activeResponders) {
      try {
        await messaging.send({
          token: responder.token,
          ...message
        });
        delivered += 1;
        nextResponders.push({
          ...responder,
          active: true,
          lastError: '',
          lastSentAt: sentAt,
          updatedAt: sentAt
        });
      } catch (error) {
        failed += 1;
        nextResponders.push({
          ...responder,
          active: isTokenPermanentFailure(error) ? false : responder.active !== false,
          lastError: normalizeText(error?.message || 'Send failed', 240),
          updatedAt: sentAt
        });
      }
    }

    await saveResponders(mergeResponders(await loadResponders(), nextResponders));

    const statusCode = delivered > 0 ? 200 : 500;

    res.status(statusCode).json({
      ok: delivered > 0,
      strategy: 'direct',
      locationId,
      locationName,
      sentAt,
      responderCount: activeResponders.length,
      delivered,
      failed
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to send the emergency alert.'
    });
  }
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))) {
      res.status(403).json({ ok: false, error: 'Origin not allowed.' });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

function loadServiceAccount(filePath) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH points to a missing file: ${resolvedPath}`);
  }

  try {
    const contents = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Could not read Firebase service account JSON at ${resolvedPath}: ${error.message}`);
  }
}

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  return {};
}

async function readLocationName(locationId) {
  try {
    const raw = await fsp.readFile(LOCATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const locations = Array.isArray(parsed.locations) ? parsed.locations : [];
    const match = locations.find((location) => location && location.id === locationId);
    return normalizeText(match?.name, 120) || '';
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function loadResponders() {
  try {
    const raw = await fsp.readFile(RESPONDERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return dedupeResponders(parsed);
    }

    if (Array.isArray(parsed.responders)) {
      return dedupeResponders(parsed.responders);
    }

    return [];
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function saveResponders(respondersList) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const deduped = dedupeResponders(respondersList);
  const tempFile = `${RESPONDERS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(deduped, null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, RESPONDERS_FILE);
}

function mergeResponders(existingResponders, updatedResponders) {
  const updatesByToken = new Map(updatedResponders.map((responder) => [responder.token, responder]));
  const merged = [];
  const seen = new Set();

  for (const responder of existingResponders) {
    const nextResponder = updatesByToken.get(responder.token) || responder;
    merged.push(nextResponder);
    seen.add(nextResponder.token);
  }

  for (const responder of updatedResponders) {
    if (!seen.has(responder.token)) {
      merged.push(responder);
    }
  }

  return merged;
}

function dedupeResponders(respondersList) {
  const seen = new Set();
  const nextResponders = [];

  for (const responder of respondersList) {
    const token = normalizeText(responder?.token, 4096);

    if (!token || seen.has(token)) {
      continue;
    }

    seen.add(token);
    nextResponders.push({
      token,
      deviceName: normalizeText(responder.deviceName, 80) || 'Unknown device',
      userAgent: normalizeText(responder.userAgent, 240),
      platform: normalizeText(responder.platform, 120),
      active: responder.active !== false,
      topic: normalizeText(responder.topic, 40) || RESPONDER_TOPIC,
      createdAt: normalizeText(responder.createdAt, 40),
      updatedAt: normalizeText(responder.updatedAt, 40),
      lastRegisteredAt: normalizeText(responder.lastRegisteredAt, 40),
      lastSentAt: normalizeText(responder.lastSentAt, 40),
      lastError: normalizeText(responder.lastError, 240),
      topicSubscribed: responder.topicSubscribed !== false
    });
  }

  return nextResponders;
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function hashToken(token) {
  return require('crypto').createHash('sha256').update(token).digest('hex');
}

function isTokenPermanentFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return (
    message.includes('registration-token-not-registered') ||
    message.includes('invalid-registration-token') ||
    code.includes('registration-token-not-registered') ||
    code.includes('invalid-registration-token')
  );
}

