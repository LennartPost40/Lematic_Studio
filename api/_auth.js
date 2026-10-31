// Gemeinsame Login-Prüfung für alle Serverfunktionen: nur Google-Konten der Domain lematic.de
// (plus optional ALLOWED_EMAILS aus den Vercel-Umgebungsvariablen).
const ALLOWED_DOMAINS = ['lematic.de'];
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Kurzer Cache, damit nicht jede Anfrage erneut bei Google nachfragt.
const authCache = new Map();
export async function checkGoogle(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return { ok: false, status: 401, error: 'Nicht angemeldet' };
  const hit = authCache.get(token);
  if (hit && hit.until > Date.now()) return hit.res;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + token }
  });
  let res;
  if (!r.ok) {
    res = { ok: false, status: 401, error: 'Google-Anmeldung abgelaufen' };
  } else {
    const me = await r.json();
    const email = (me.email || '').toLowerCase();
    const domain = email.split('@')[1] || '';
    const allowed = me.email_verified !== false &&
      (ALLOWED_DOMAINS.includes(domain) || ALLOWED_EMAILS.includes(email));
    res = allowed ? { ok: true, email } : { ok: false, status: 403, error: email + ' ist nicht freigegeben' };
  }
  authCache.set(token, { res, until: Date.now() + 5 * 60 * 1000 });
  if (authCache.size > 200) authCache.delete(authCache.keys().next().value);
  return res;
}

