import {
  getConfigWarnings,
  hasFirebaseConfig,
  registerMessagingServiceWorker,
  registerPushToken,
  sendEmergencyAlert
} from './firebase.js';
import { getLocationById, getLocations, getProjectName } from './locations.js';
import './styles.css';

const appRoot = document.querySelector('#app');

render();

window.addEventListener('hashchange', render);

function render() {
  const route = parseRoute();
  const configWarnings = getConfigWarnings();
  const location = route.name === 'help' ? getLocationById(route.locationId) : null;
  const pageTitle =
    route.name === 'help'
      ? `${location?.name || route.locationId} - QR Emergency Help`
      : route.name === 'register'
        ? 'Register this device - QR Emergency Help'
        : 'QR Emergency Help';

  document.title = pageTitle;

  appRoot.innerHTML = `
    <div class="shell">
      <header class="hero">
        <div class="brand">
          <span class="brand-mark">Q</span>
          <div>
            <p class="eyebrow">${escapeHtml(getProjectName())}</p>
            <h1>Emergency help, one scan away.</h1>
          </div>
        </div>
        <p class="lede">
          Public QR codes can open a help page for any location, while responders
          self-register this web app to receive Firebase push alerts.
        </p>
        <div class="hero-actions">
          <a class="button primary" href="#/register">Register a responder device</a>
          <a class="button secondary" href="#/help/LOC-NTB01">Open a sample help page</a>
        </div>
      </header>

      ${configWarnings.length ? renderConfigNotice(configWarnings) : ''}

      <main class="content">
        ${renderRoute(route, location)}
        ${renderLocations()}
      </main>
    </div>
  `;

  bindForms(route, location);
}

function renderConfigNotice(missing) {
  return `
    <section class="card warning">
      <h2>Firebase config needed</h2>
      <p>
        Fill in <code>public/firebase-config.js</code> before testing registration or push delivery.
      </p>
      <p class="muted">Missing: ${escapeHtml(missing.join(', '))}</p>
    </section>
  `;
}

function renderRoute(route, location) {
  if (route.name === 'register') {
    return renderRegisterCard();
  }

  if (route.name === 'help') {
    return renderHelpCard(route.locationId, location);
  }

  return `
    <section class="card">
      <h2>How it works</h2>
      <ol class="steps">
        <li>Place a QR code at each location.</li>
        <li>When someone scans it, they land on the help page.</li>
        <li>They tap one button to send the alert to every registered responder.</li>
        <li>Responder devices open this site once and tap register to receive pushes.</li>
      </ol>
    </section>
    <section class="card">
      <h2>Responder setup</h2>
      <p>
        Open the registration page on each device you want to receive notifications on.
      </p>
      <a class="button primary" href="#/register">Go to registration</a>
    </section>
  `;
}

function renderRegisterCard() {
  const configReady = hasFirebaseConfig();

  return `
    <section class="card action-card">
      <div class="card-head">
        <div>
          <p class="eyebrow">Responder device</p>
          <h2>Register this browser for push alerts</h2>
        </div>
        <span class="pill ${configReady ? 'ok' : 'muted'}">${configReady ? 'Ready' : 'Needs config'}</span>
      </div>
      <p>
        No app install is needed. Open this page on the responder device, allow notifications,
        and the device will subscribe to Firebase Cloud Messaging.
      </p>
      <form id="register-form" class="stack">
        <label>
          Device label
          <input name="deviceName" type="text" placeholder="Front desk phone" maxlength="80" required />
        </label>
        <button class="button primary" type="submit">Enable notifications</button>
      </form>
      <p id="register-status" class="status muted">Waiting for registration.</p>
    </section>
  `;
}

function renderHelpCard(locationId, location) {
  const title = location?.name || locationId;

  return `
    <section class="card action-card danger">
      <div class="card-head">
        <div>
          <p class="eyebrow">Help request</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <span class="pill danger">Public</span>
      </div>
      <p>
        This page can notify every registered responder device. Press the button once to send the alert.
      </p>
      <div class="details">
        <div><span>Location ID</span><strong>${escapeHtml(locationId)}</strong></div>
        <div><span>Location name</span><strong>${escapeHtml(title)}</strong></div>
      </div>
      <button id="send-alert" class="button danger-button" type="button">
        Send emergency alert
      </button>
      <p id="help-status" class="status muted">Ready to send.</p>
    </section>
  `;
}

function renderLocations() {
  const locations = getLocations();

  return `
    <section class="card">
      <div class="card-head">
        <div>
          <p class="eyebrow">Known locations</p>
          <h2>Current mapping</h2>
        </div>
        <span class="pill">${locations.length} entries</span>
      </div>
      <div class="location-grid">
        ${locations
          .map(
            (location) => `
              <a class="location" href="#/help/${encodeURIComponent(location.id)}">
                <strong>${escapeHtml(location.name)}</strong>
                <span>${escapeHtml(location.id)}</span>
              </a>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function bindForms(route, location) {
  const registerForm = document.querySelector('#register-form');
  const registerStatus = document.querySelector('#register-status');
  const sendAlertButton = document.querySelector('#send-alert');
  const helpStatus = document.querySelector('#help-status');

  if (registerForm && registerStatus) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!configReadyForPush()) {
        registerStatus.textContent = 'Add Firebase values in public/firebase-config.js first.';
        registerStatus.className = 'status error';
        return;
      }

      const formData = new FormData(registerForm);
      const deviceName = String(formData.get('deviceName') || '').trim();

      if (!deviceName) {
        registerStatus.textContent = 'Please enter a device label.';
        registerStatus.className = 'status error';
        return;
      }

      try {
        registerStatus.textContent = 'Preparing notification access...';
        registerStatus.className = 'status muted';

        const serviceWorkerRegistration = await registerMessagingServiceWorker();
        const result = await registerPushToken({
          deviceName,
          serviceWorkerRegistration
        });

        registerStatus.textContent = `Registered successfully as ${result.deviceName || deviceName}.`;
        registerStatus.className = 'status success';
      } catch (error) {
        registerStatus.textContent = error.message || 'Registration failed.';
        registerStatus.className = 'status error';
      }
    });
  }

  if (sendAlertButton && helpStatus) {
    sendAlertButton.addEventListener('click', async () => {
      const locationId = route.locationId;
      const locationName = location?.name || locationId;

      try {
        sendAlertButton.disabled = true;
        helpStatus.textContent = 'Sending alert...';
        helpStatus.className = 'status muted';

        const result = await sendEmergencyAlert({
          locationId,
          locationName
        });

        helpStatus.textContent = `Alert sent to ${result.delivered} responder device(s).`;
        helpStatus.className = 'status success';
      } catch (error) {
        helpStatus.textContent = error.message || 'Failed to send alert.';
        helpStatus.className = 'status error';
      } finally {
        sendAlertButton.disabled = false;
      }
    });
  }
}

function parseRoute() {
  const hashPath = getHashPath();
  const trimmed = (hashPath || window.location.pathname).replace(/\/+$/, '') || '/';

  if (trimmed === '/register') {
    return { name: 'register' };
  }

  const helpMatch = trimmed.match(/^\/help\/([^/]+)$/);
  if (helpMatch) {
    return {
      name: 'help',
      locationId: decodeURIComponent(helpMatch[1])
    };
  }

  return { name: 'home' };
}

function getHashPath() {
  const hash = window.location.hash || '';

  if (!hash.startsWith('#/')) {
    return '';
  }

  return hash.slice(1);
}

function configReadyForPush() {
  return hasFirebaseConfig();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
