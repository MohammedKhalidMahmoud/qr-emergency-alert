const crypto = require('crypto');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');

admin.initializeApp();

const db = admin.firestore();
const responders = db.collection('responders');

exports.api = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const pathname = normalizePath(req.url);

  try {
    if (req.method === 'GET' && pathname === '/health') {
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/register') {
      await handleRegister(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/notify') {
      await handleNotify(req, res);
      return;
    }

    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || 'Unexpected error'
    });
  }
});

async function handleRegister(req, res) {
  const body = await readJsonBody(req);
  const token = normalizeToken(body.token);
  const deviceName = normalizeText(body.deviceName, 80) || 'Unknown device';
  const userAgent = normalizeText(body.userAgent, 200) || '';
  const platform = normalizeText(body.platform, 80) || '';
  const tokenId = hashToken(token);

  await responders.doc(tokenId).set(
    {
      token,
      deviceName,
      userAgent,
      platform,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  res.status(200).json({
    ok: true,
    tokenId,
    deviceName
  });
}

async function handleNotify(req, res) {
  const body = await readJsonBody(req);
  const locationId = normalizeText(body.locationId, 80);
  const locationName = normalizeText(body.locationName, 120) || locationId;

  if (!locationId) {
    res.status(400).json({ error: 'locationId is required.' });
    return;
  }

  const snapshot = await responders.where('active', '==', true).get();
  const tokens = snapshot.docs
    .map((document) => ({
      id: document.id,
      ref: document.ref,
      token: document.data().token
    }))
    .filter((entry) => normalizeToken(entry.token));

  const payload = {
    notification: {
      title: 'Emergency help request',
      body: `${locationName} (${locationId})`
    },
    data: {
      locationId,
      locationName,
      href: `/help/${encodeURIComponent(locationId)}`,
      sentAt: new Date().toISOString()
    }
  };

  const result = {
    requested: tokens.length,
    delivered: 0,
    failed: 0
  };

  for (const entry of tokens) {
    try {
      await admin.messaging().send({
        token: entry.token,
        notification: payload.notification,
        data: payload.data,
        webpush: {
          notification: {
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: locationId,
            renotify: true
          }
        }
      });
      result.delivered += 1;
      await entry.ref.set(
        {
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          lastError: admin.firestore.FieldValue.delete()
        },
        { merge: true }
      );
    } catch (error) {
      result.failed += 1;
      await markTokenInactive(entry.ref, error);
    }
  }

  res.status(200).json({
    ok: true,
    locationId,
    locationName,
    ...result
  });
}

async function markTokenInactive(ref, error) {
  await ref.set(
    {
      active: false,
      lastError: normalizeText(error?.message || 'Send failure', 240),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function normalizePath(requestUrl) {
  const parsed = new URL(requestUrl, 'http://localhost');
  return parsed.pathname.replace(/^\/api/, '') || '/';
}

function normalizeToken(token) {
  return typeof token === 'string' ? token.trim() : '';
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
