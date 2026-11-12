// Startet das Studio lokal ohne Google-Login: eigener kleiner Server, nachgebaute Antworten von Notion, Kalender, Drive und Gmail.
// Alle Namen und Zahlen sind erfunden. Echte Schlüssel oder Kundendaten werden nicht gebraucht.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/json' };
const pad = n => String(n).padStart(2, '0');
const day = o => { const d = new Date(); d.setDate(d.getDate() + o); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) };

const kunden = [['k1', 'Hafenwerk GmbH', 'Bestandskunde'], ['k2', 'Nordlicht Events', 'Warm'], ['k3', 'Studio Elbe', 'Angefragt'], ['k4', 'Kranbau Petersen', 'Bestandskunde'], ['k5', 'Deichgut Hofladen', 'Kalt'], ['k6', 'Messe Nordbau', 'Warm']]
  .map(([id, n, s]) => ({ id, url: '', Name: n, Status: s, Typ: 'Firma', Ansprechpartner: 'Kontakt ' + n, 'E-Mail': 'kontakt@' + id + '.example', Notizen: 'Demo' }));
const aufgaben = [['Angebot Hafenwerk nachfassen', -3, 'Lennart', 'k1'], ['Rohschnitt Messefilm schicken', -1, 'Martin', 'k6'], ['Rechnung Studio Elbe schreiben', 0, 'Lennart', 'k3'], ['Drohne für Dreh laden', 0, 'Lennart', ''], ['Musik lizenzieren', 1, 'Martin', 'k2'], ['Storyboard Kranbau abstimmen', 2, 'Lennart', 'k4'], ['Farbkorrektur Recap', 3, 'Martin', 'k2'], ['Untertitel exportieren', 5, 'Lennart', 'k1'], ['Hofladen anrufen', 9, 'Martin', 'k5'], ['Jahresrückblick planen', 14, 'Lennart', '']]
  .map(([t, o, w, k], i) => ({ id: 't' + i, url: '', Aufgabe: t, Wer: w, Deadline: day(o), Status: 'Nicht begonnen', Kunde: k ? [k] : [], 'Im Studio': true, 'In Kalender': i === 4, 'Angelegt von': 'Lennart' }));
const rechnungen = [['RE-2001', 'k1', 2400, 'Bezahlt', -40], ['RE-2002', 'k4', 1800, 'Bezahlt', -25], ['RE-2003', 'k2', 950, 'Offen', -20], ['RE-2004', 'k6', 3200, 'Offen', -6], ['LM-2026-0101', 'k3', 4100, 'Angenommen', -10], ['RE-2005', 'k1', 600, 'Bezahlt', -70], ['RE-2006', 'k4', 1250, 'Bezahlt', -100], ['RE-2007', 'k2', 700, 'Bezahlt', -130]]
  .map(([no, k, a, s, o], i) => ({ id: 'r' + i, url: '', Nummer: no, Name: no, Art: no.startsWith('RE') ? 'Rechnung' : 'Angebot', Status: s, Betrag: a, Datum: day(o), 'Fällig am': day(o + 14), Leistung: 'Demo-Leistung', Kunde: [k] }));
const ev = (id, sum, o, h, dur, art, loc) => ({ id, summary: sum, status: 'confirmed', htmlLink: '', location: loc || '', start: h == null ? { date: day(o) } : { dateTime: day(o) + 'T' + pad(h) + ':00:00+01:00' }, end: h == null ? { date: day(o + 1) } : { dateTime: day(o) + 'T' + pad(h + dur) + ':00:00+01:00' }, extendedProperties: { private: { lmArt: art, lmWho: 'LP' } } });
const termine = [ev('e1', 'Dreh Hafenwerk Imagefilm', 0, 9, 6, 'dreh', 'Hamburg Hafen'), ev('e2', 'Call Nordlicht Events', 0, 16, 1, 'termin', 'Zoom'), ev('e3', 'Schnitt Messefilm', 1, 10, 4, 'schnitt', ''), ev('e4', 'Pitch Studio Elbe', 3, 14, 1, 'akquise', 'Altona'), ev('e5', 'Dreh Kranbau', 6, 8, 8, 'dreh', 'Geesthacht'), ev('e6', 'Belegt: Urlaub', 10, null, 0, 'belegt', '')];

// Optionen: W/H Fenstergröße, mobile (Handy 390 × 844), theme 'light'|'dark', delay ms Netz-Verzögerung, reduced „Weniger Bewegung“
export async function start({ W = 1440, H = 900, mobile = false, theme = 'light', delay = 0, reduced = false } = {}) {
  if (mobile) { W = 390; H = 844 }
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x'); let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
    if (p.startsWith('/api/')) {
      const db = u.searchParams.get('db'); let body = { ok: true, configured: false, rows: [] };
      if (p === '/api/notion') body = u.searchParams.get('schema')
        ? { props: { Name: { type: 'title' }, Status: { type: 'select', options: ['Bestandskunde', 'Warm', 'Angefragt', 'Kalt', 'Abgesagt', 'Archiv'].map(name => ({ name })) }, Typ: { type: 'select' }, Ansprechpartner: { type: 'rich_text' }, 'E-Mail': { type: 'email' }, Notizen: { type: 'rich_text' } } }
        : { rows: db === 'kunden' ? kunden : db === 'aufgaben' ? (u.searchParams.get('studio') ? aufgaben : []) : db === 'rechnungen' ? rechnungen : [] };
      if (p === '/api/sevdesk') body = { ok: false, error: 'Test ohne sevDesk' };
      return setTimeout(() => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify(body)) }, delay);
    }
    const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('nicht gefunden') }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
  }).listen(0);
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || undefined });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile, locale: 'de-DE', timezoneId: 'Europe/Berlin', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await page.route(/googleapis\.com|accounts\.google\.com|frankfurter|gstatic/, r => {
    const url = r.request().url();
    if (url.includes('gsi/client')) return r.fulfill({ contentType: 'text/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}}),revoke(){}},id:{initialize(){},renderButton(){}}}};' });
    const body = url.includes('/calendar/') ? { items: termine } : { items: [], files: [], messages: [], name: 'LeMatic', id: 'x' };
    setTimeout(() => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }), delay);
  });
  await page.addInitScript(t => { try { localStorage.setItem('lm_person', 'LP'); localStorage.setItem('lm_theme', t) } catch (_) { } }, theme);
  await page.goto('http://127.0.0.1:' + srv.address().port + '/'); await page.waitForTimeout(500);
  const h = {
    page, errs,
    // Login ohne Google: Token setzen, Studio starten, Einführung und Update-Fenster aus dem Weg
    login: () => page.evaluate(() => { try { localStorage.setItem('lm_seen_version', APP_VERSION) } catch (_) { } accessToken = 'x'; tokenExpiry = Date.now() + 3600e3; enterGoogle({ email: 'info@lematic.de' }); return APP_VERSION }),
    // Alles wegräumen, was Klicks verdeckt: offene Dialoge, Einführung, Hinweise, Erinnerungen
    tidy: () => page.evaluate(() => { document.querySelectorAll('.modal-wrap.show').forEach(w => { w.classList.remove('show'); w.setAttribute('aria-hidden', 'true') }); const o = document.getElementById('onb'); if (o) o.hidden = true; document.body.classList.remove('onb-open'); document.querySelectorAll('.view-hint,.remind').forEach(x => x.remove()) }),
    go: async (route, ms = 700) => { await page.evaluate(x => { location.hash = '#/' + x }, route); await page.waitForTimeout(ms); await h.tidy() },
    close: async () => { await browser.close(); srv.close() }
  };
  return h;
}
