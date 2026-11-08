// Vercel Serverless Function: Proxy zwischen LeMatic Studio und sevDesk (nur lesen).
// Der Token liegt ausschließlich in Vercel (Environment Variable SEVDESK_API_KEY) und geht nie in den Browser.
// sevDesk-Tokens laufen nie ab und haben alle Rechte des Benutzers. Deshalb kennt dieser Proxy nur feste
// Lese-Abfragen (?op=status | umsaetze | rechnungen | belege). Nichts wird in sevDesk gebucht, geändert oder verschickt.
//
// Zugriffsschutz wie bei Notion: Google-Token der eingeloggten Person im Header, nur lematic.de (plus ALLOWED_EMAILS).

import { checkGoogle } from './_auth.js';

const BASE = 'https://my.sevdesk.de/api/v1';
// sevDesk liefert Datumswerte als ISO mit Zeitzone, als Unix-Zeit oder als TT.MM.JJJJ. Immer als Berliner Datum zurückgeben.
function day(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  let d;
  if (/^\d{9,11}$/.test(s)) d = new Date(+s * 1000);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  else d = new Date(s);
  if (isNaN(d)) return s.slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}
const plusDays = (d, n) => { if (!d || !n) return ''; const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + (+n || 0)); return x.toISOString().slice(0, 10); };

async function sd(path, key) {
  const r = await fetch(BASE + path, { headers: { Authorization: key, Accept: 'application/json' } });
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) {
    const msg = r.status === 401 ? 'SEVDESK_API_KEY ist ungültig oder wurde erneuert'
      : (j && j.error && (j.error.message || j.error)) || ('sevDesk HTTP ' + r.status);
    const e = new Error(typeof msg === 'string' ? msg : 'sevDesk-Fehler'); e.status = r.status; throw e;
  }
  return (j && j.objects) || [];
}

// Alle Seiten holen (sevDesk: limit/offset), höchstens 20 × 500 Einträge.
async function all(path, key) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let p = 0; p < 20; p++) {
    const rows = await sd(`${path}${sep}limit=500&offset=${p * 500}`, key);
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out;
}

async function konten(key) {
  const rows = await sd('/CheckAccount', key);
  return rows.map(k => ({
    id: String(k.id), name: k.name || 'Konto', typ: k.type || '', aktiv: String(k.status) !== '0',
    iban: k.iban ? '…' + String(k.iban).replace(/\s/g, '').slice(-4) : '', bank: k.bankServer || '', import: k.importType || ''
  }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Nur Lesen erlaubt' });

  try {
    const auth = await checkGoogle(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  } catch (e) {
    return res.status(502).json({ error: 'Google-Prüfung fehlgeschlagen: ' + e.message });
  }

  const key = process.env.SEVDESK_API_KEY;
  if (!key) return res.status(501).json({ error: 'SEVDESK_API_KEY ist in Vercel noch nicht hinterlegt' });

  const { op, from } = req.query || {};
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : '';

  try {
    if (op === 'status') {
      let version = '';
      try { const v = await sd('/Tools/bookkeepingSystemVersion', key); version = (v && v.version) || ''; } catch (_) {}
      return res.status(200).json({ ok: true, version, konten: await konten(key) });
    }

    if (op === 'umsaetze') {
      // Nur echte Bankkonten (online/offline, aktiv), keine Kasse.
      const ks = (await konten(key)).filter(k => k.aktiv && k.typ !== 'register');
      const ids = new Map(ks.map(k => [k.id, k.name]));
      let rows;
      try {
        rows = await all('/CheckAccountTransaction' + (fromDay ? '?startDate=' + encodeURIComponent(fromDay) : ''), key);
      } catch (e) {
        // Falls sevDesk das Datumsformat ablehnt: alles holen und hier filtern.
        if (!fromDay || e.status !== 400) throw e;
        rows = await all('/CheckAccountTransaction', key);
      }
      const tx = rows
        .filter(t => t.checkAccount && ids.has(String(t.checkAccount.id)))
        .map(t => ({
          sid: String(t.id),
          date: day(t.entryDate || t.valueDate),
          name: t.payeePayerName || '',
          amount: Math.round((+t.amount || 0) * 100) / 100,
          purpose: t.paymtPurpose || '',
          privat: String(t.status) === '300',
          konto: ids.get(String(t.checkAccount.id)) || ''
        }))
        .filter(t => t.date && t.amount && (!fromDay || t.date >= fromDay))
        .sort((a, b) => a.date.localeCompare(b.date));
      return res.status(200).json({ konten: ks, tx });
    }

    if (op === 'rechnungen') {
      const ts = fromDay ? Math.floor(new Date(fromDay + 'T00:00:00Z').getTime() / 1000) : 0;
      const rows = await all('/Invoice?embed=contact' + (ts ? '&startDate=' + ts : ''), key);
      const name = c => !c ? '' : (c.name || [c.surename, c.familyname].filter(Boolean).join(' ') || '');
      const inv = rows.map(i => ({
        sid: String(i.id),
        faellig: plusDays(day(i.invoiceDate), i.timeToPay),
        nr: i.invoiceNumber || '',
        status: +i.status || 0,              // 50 deaktiviert, 100 Entwurf, 200 offen, 750 teilweise bezahlt, 1000 bezahlt
        typ: i.invoiceType || '',
        datum: day(i.invoiceDate),
        bezahltAm: day(i.payDate),
        brutto: +i.sumGross || 0,
        bezahlt: +i.paidAmount || 0,
        kunde: name(i.contact)
      })).filter(i => i.nr && (!fromDay || !i.datum || i.datum >= fromDay));
      return res.status(200).json({ rechnungen: inv });
    }

    if (op === 'belege') {
      // Belege (Ausgaben C, sonstige Einnahmen D). Etwas früher anfangen, weil das Zahlungsdatum nach dem Belegdatum liegen kann.
      let ts = 0;
      if (fromDay) { const d = new Date(fromDay + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 90); ts = Math.floor(d.getTime() / 1000); }
      const rows = await all('/Voucher?embed=supplier' + (ts ? '&startDate=' + ts : ''), key);
      const name = v => v.supplierName || (v.supplier && (v.supplier.name || [v.supplier.surename, v.supplier.familyname].filter(Boolean).join(' '))) || '';
      const bel = rows.filter(v => v.voucherType !== 'RV').map(v => ({
        sid: String(v.id),
        art: v.creditDebit === 'D' ? 'D' : 'C',   // C = Ausgabe, D = Einnahme
        status: +v.status || 0,                    // 50 Entwurf, 100 offen, 150 überwiesen, 750 teilweise bezahlt, 1000 bezahlt
        datum: day(v.voucherDate),
        bezahltAm: day(v.payDate),
        brutto: Math.abs(+v.sumGross || 0),
        bezahlt: Math.abs(+v.paidAmount || 0),
        name: name(v),
        nr: v.description || ''
      }));
      return res.status(200).json({ belege: bel });
    }

    return res.status(400).json({ error: 'Unbekannte Abfrage: ' + op });
  } catch (e) {
    return res.status(e.status === 401 ? 401 : 502).json({ error: e.message });
  }
}
