import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

function readGlobalConfig() {
  return globalThis.FIREBASE_CONFIG || globalThis.firebaseConfig || {};
}

function readVapidKey() {
  return globalThis.FIREBASE_VAPID_KEY || '';
}

function readApiBaseUrl() {
  const appConfig = globalThis.APP_CONFIG || globalThis.appConfig || {};
  return String(appConfig.apiBaseUrl || globalThis.API_BASE_URL || '').trim();
}

export function hasFirebaseConfig() {
  const config = readGlobalConfig();
  return Boolean(
    config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.messagingSenderId &&
      config.appId &&
      readVapidKey()
  );
}

export function getConfigWarnings() {
  const config = readGlobalConfig();
  const missing = [];

  if (!config.apiKey) missing.push('apiKey');
  if (!config.authDomain) missing.push('authDomain');
  if (!config.projectId) missing.push('projectId');
  if (!config.messagingSenderId) missing.push('messagingSenderId');
  if (!config.appId) missing.push('appId');
  if (!readVapidKey()) missing.push('FIREBASE_VAPID_KEY');
  if (!readApiBaseUrl()) missing.push('apiBaseUrl');

  return missing;
}

export function getApiBaseUrl() {
  return readApiBaseUrl();
}

function buildApiUrl(pathname) {
  const baseUrl = readApiBaseUrl();

  if (!baseUrl) {
    throw new Error('Set the backend API base URL in public/firebase-config.js.');
  }

  const sanitizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = String(pathname).replace(/^\/+/, '');
  const apiBase = sanitizedBaseUrl.endsWith('/api') ? sanitizedBaseUrl : `${sanitizedBaseUrl}/api`;

  return `${apiBase}/${normalizedPath}`;
}

function getAppInstance() {
  const config = readGlobalConfig();

  if (!getApps().length) {
    return initializeApp(config);
  }

  return getApp();
}

export async function ensureMessaging() {
  if (!(await isSupported())) {
    throw new Error('This browser does not support Firebase messaging.');
  }

  return getMessaging(getAppInstance());
}

export async function registerPushToken({ deviceName, serviceWorkerRegistration }) {
  if (!('Notification' in globalThis)) {
    throw new Error('Notification permission is not available in this browser.');
  }

  const messaging = await ensureMessaging();
  const permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const token = await getToken(messaging, {
    vapidKey: readVapidKey(),
    serviceWorkerRegistration
  });

  if (!token) {
    throw new Error('Firebase did not return a device token.');
  }

  const response = await fetch(buildApiUrl('/register'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token,
      deviceName,
      userAgent: navigator.userAgent,
      platform: navigator.platform
    })
  });

  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw new Error(errorBody?.error || 'Failed to register the device.');
  }

  return response.json();
}

export async function sendEmergencyAlert({ locationId, locationName }) {
  const response = await fetch(buildApiUrl('/alert'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      locationId,
      locationName
    })
  });

  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw new Error(errorBody?.error || 'Failed to send the emergency alert.');
  }

  return response.json();
}

export async function registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }

  return navigator.serviceWorker.register('./firebase-messaging-sw.js');
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
