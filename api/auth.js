// Vercel Serverless Function: Anmeldung, die 7 Tage hält.
// Ablauf: Google-Login mit Autorisierungscode -> Google gibt ein Refresh-Token ->
// das liegt verschlüsselt in einem HttpOnly-Cookie (7 Tage) -> das Studio holt sich
// damit beim Neuladen still ein frisches Zugriffstoken.
// Benötigt in Vercel: GOOGLE_CLIENT_SECRET (zum Client unten, aus der Google Cloud Console).
// In der Google Cloud Console muss als "Autorisierte Weiterleitungs-URI" eingetragen sein:
//   https://<deine-domain>/api/auth?step=cb
import crypto from 'crypto';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '103865922550-oedundd8e5qet9k5j7sotgtmrs8ge8tp.apps.googleusercontent.com';
const SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SCOPES = ['openid', 'email', 'profile',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose'].join(' ');
const ALLOWED_DOMAINS = ['lematic.de'];
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const WEEK = 7 * 24 * 3600;
const RT = 'lm_rt', ST = 'lm_oauth_state';

const key = () => crypto.createHash('sha256').update('lematic-studio-session:' + SECRET).digest();
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
function open(s) {
  try {
    const b = Buffer.from(String(s || ''), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch (_) { return null; }
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const ck = (n, v, age) => `${n}=${encodeURIComponent(v)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function origin(req) {
  const h = req.headers['x-forwarded-host'] || req.headers.host;
  const p = req.headers['x-forwarded-proto'] || 'https';
  return p + '://' + h;
}
const redirectUri = req => origin(req) + '/api/auth?step=cb';
async function tokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || ('HTTP ' + r.status));
  return j;
}
function allowed(email) {
  const e = String(email || '').toLowerCase();
  return ALLOWED_DOMAINS.includes(e.split('@')[1] || '') || ALLOWED_EMAILS.includes(e);
}

export default async function handler(req, res) {
  const step = (req.query && req.query.step) || '';
  res.setHeader('Cache-Control', 'no-store');
  if (step === 'status') return res.status(200).json({ configured: !!SECRET });
  if (!SECRET) return res.status(501).json({ error: 'GOOGLE_CLIENT_SECRET fehlt in Vercel' });

  if (step === 'start') {
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', ck(ST, state, 600));
    const q = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES,
      access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state
    });
    if (req.query.hint) q.set('login_hint', String(req.query.hint));
    res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q });
    return res.end();
  }

  if (step === 'cb') {
    const c = cookies(req);
    const back = msg => { res.writeHead(302, { Location: '/?login=' + encodeURIComponent(msg) + '#/heute', 'Set-Cookie': ck(ST, '', 0) }); res.end(); };
    if (req.query.error) return back(String(req.query.error));
    if (!req.query.state || req.query.state !== c[ST]) return back('state');
    try {
      const t = await tokenCall({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: redirectUri(req) });
      const me = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
      if (!allowed(me.email)) return back('konto');
      if (!t.refresh_token) return back('refresh');
      const exp = Date.now() + WEEK * 1000;
      res.writeHead(302, { Location: '/?login=ok#/heute', 'Set-Cookie': [ck(RT, seal({ rt: t.refresh_token, email: me.email, exp }), WEEK), ck(ST, '', 0)] });
      return res.end();
    } catch (e) { return back('fehler'); }
  }

  if (step === 'token') {
    const s = open(cookies(req)[RT]);
    if (!s || !s.rt || Date.now() > s.exp) { res.setHeader('Set-Cookie', ck(RT, '', 0)); return res.status(401).json({ error: 'Nicht angemeldet' }); }
    try {
      const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: s.rt });
      return res.status(200).json({ access_token: t.access_token, expires_in: t.expires_in, scope: t.scope, email: s.email, until: s.exp });
    } catch (e) {
      res.setHeader('Set-Cookie', ck(RT, '', 0));
      return res.status(401).json({ error: 'Anmeldung abgelaufen' });
    }
  }

  if (step === 'logout') {
    const s = open(cookies(req)[RT]);
    if (s && s.rt) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(s.rt), { method: 'POST' }); } catch (_) {} }
    res.setHeader('Set-Cookie', ck(RT, '', 0));
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'Unbekannter Schritt' });
}
