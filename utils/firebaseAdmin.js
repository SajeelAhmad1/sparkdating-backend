const path = require('path');
const admin = require('firebase-admin');

function tryInitFromServiceAccountFile() {
  const rel = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!rel || !String(rel).trim()) return false;
  const resolved = path.isAbsolute(rel) ? rel : path.join(__dirname, '..', rel);
  try {
    // Same pattern as Firebase docs: credential.cert(serviceAccount)
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const serviceAccount = require(resolved);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[FCM] FIREBASE_SERVICE_ACCOUNT_PATH load failed:', e.message);
    return false;
  }
}

function tryInitFromJson() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !String(raw).trim()) return false;
  try {
    const cred = JSON.parse(String(raw));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON parse/init failed:', e.message);
    return false;
  }
}

function tryInitFromApplicationDefault() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {import('firebase-admin/messaging').Messaging | null}
 */
function getMessaging() {
  if (admin.apps.length > 0) {
    return admin.messaging();
  }
  if (tryInitFromServiceAccountFile()) {
    return admin.messaging();
  }
  if (tryInitFromJson()) {
    return admin.messaging();
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && tryInitFromApplicationDefault()) {
    return admin.messaging();
  }
  return null;
}

module.exports = {
  getMessaging
};
