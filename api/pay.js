// Vercel Serverless Function: Bezahlung der Zentrale-Pro-Module über Stripe.
// Benötigt in Vercel die Environment Variable STRIPE_SECRET_KEY (Testmodus: sk_test_…).
// Kein Webhook und keine eigene Datenbank nötig: Welche Module freigeschaltet sind, wird bei jedem Aufruf
// direkt bei Stripe nachgesehen (aktive Abos mit metadata.module). Kündigung oder Zahlungsausfall sperren
// das Modul dadurch automatisch wieder.
import { checkGoogle } from './_auth.js';

// Preise stehen nur hier auf dem Server, der Browser kann sie nicht verändern.
const MODULES = {
  calls:     { name: 'Anruf-Assistent',         eur: 39 },
  erechnung: { name: 'E-Rechnung-Autopilot',    eur: 39 },
  report:    { name: 'Montags-Bericht',         eur: 29 },
  whatsapp:  { name: 'WhatsApp-Business-Inbox', eur: 39 },
  offer:     { name: 'Angebots-Generator',      eur: 35 },
  reminders: { name: 'Smart-Erinnerungen',      eur: 29 },
  bundle:    { name: 'Zentrale Pro Komplett',   eur: 149 }
};
const ACCOUNT = 'lematic'; // später pro Kunde der Zentrale

function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, key, out);
    else if (v !== undefined && v !== null) out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
async function stripe(key, path, method = 'GET', body) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body) : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe-Fehler ' + r.status);
  return j;
}
async function activeSubs(key) {
  const subs = [];
  let starting_after;
  for (let i = 0; i < 5; i++) {
    const q = 'subscriptions?status=all&limit=100' + (starting_after ? '&starting_after=' + starting_after : '');
    const j = await stripe(key, q);
    subs.push(...j.data);
    if (!j.has_more) break;
    starting_after = j.data[j.data.length - 1].id;
  }
  return subs.filter(s => (s.metadata || {}).account === ACCOUNT && ['active', 'trialing', 'past_due'].includes(s.status));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let auth;
  try {
    auth = await checkGoogle(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  } catch (e) {
    return res.status(502).json({ error: 'Google-Prüfung fehlgeschlagen: ' + e.message });
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(501).json({ error: 'Bezahlung ist noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt in Vercel).' });
  const mode = key.startsWith('sk_live') ? 'live' : 'test';
  const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;

  try {
    if (req.method === 'GET') {
      const subs = await activeSubs(key);
      const owned = {};
      for (const s of subs) {
        const m = s.metadata.module;
        if (MODULES[m]) owned[m] = { since: new Date(s.created * 1000).toISOString().slice(0, 10), status: s.status, cancelAt: s.cancel_at ? new Date(s.cancel_at * 1000).toISOString().slice(0, 10) : '' };
      }
      return res.status(200).json({ mode, owned, modules: MODULES });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Methode nicht erlaubt' });
    const { action, module } = req.body || {};

    if (action === 'checkout') {
      const m = MODULES[module];
      if (!m) return res.status(400).json({ error: 'Unbekanntes Modul' });
      const subs = await activeSubs(key);
      if (subs.some(s => s.metadata.module === module || s.metadata.module === 'bundle'))
        return res.status(409).json({ error: 'Schon freigeschaltet' });
      const session = await stripe(key, 'checkout/sessions', 'POST', {
        mode: 'subscription',
        success_url: origin + '/#/premium?bezahlt=' + module,
        cancel_url: origin + '/#/premium',
        customer_email: auth.email || undefined,
        client_reference_id: ACCOUNT,
        locale: 'de',
        allow_promotion_codes: 'true',
        line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: m.eur * 100, recurring: { interval: 'month' }, product_data: { name: 'LeMatic Zentrale – ' + m.name } } } },
        subscription_data: { metadata: { account: ACCOUNT, module, by: auth.email || '' } },
        metadata: { account: ACCOUNT, module }
      });
      return res.status(200).json({ url: session.url, mode });
    }

    if (action === 'portal') {
      const subs = await activeSubs(key);
      if (!subs.length) return res.status(404).json({ error: 'Noch kein Abo vorhanden' });
      const portal = await stripe(key, 'billing_portal/sessions', 'POST', { customer: subs[0].customer, return_url: origin + '/#/premium', locale: 'de' });
      return res.status(200).json({ url: portal.url });
    }
    return res.status(400).json({ error: 'Unbekannte Aktion' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
