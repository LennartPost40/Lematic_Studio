// Vercel Serverless Function: Proxy zwischen LeMatic Studio und Notion.
// Grund: Die Notion-API lässt sich aus dem Browser nicht direkt aufrufen (CORS),
// und der Token darf niemals im öffentlichen Frontend-Code stehen.
// Token in Vercel hinterlegen als Environment Variable: NOTION_TOKEN
//
// Zugriffsschutz: Jede Anfrage muss das Google-Token der eingeloggten Person mitschicken
// (Header "Authorization: Bearer …"). Die Funktion prüft bei Google, welches Konto das ist,
// und lässt nur Adressen der Domain lematic.de durch. Weitere Adressen optional über die
// Environment Variable ALLOWED_EMAILS (kommagetrennt).

// Klassische Datenbank-IDs (nicht die neueren "Data Source"-IDs).
// Die REST-API (Version 2022-06-28) erwartet diese Datenbank-IDs.
const DS = {
  rechnungen: 'b1b8239b-195c-47c2-b60c-007cb5c78b3d',
  akquise:    'c33aace4-5c10-42c7-88d6-08a9fb7af12d',
  projekte:   'ff5a312a-562f-48bb-a320-f32ab245ba81',
  kunden:     '1a47c61b-a5b6-416e-b4f2-d32454de35f2',
  laufwerke:  '0bba1261-69bd-49c1-ab22-beaf50ead987'
};

const ALLOWED_DOMAINS = ['lematic.de'];
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Kurzer Cache, damit nicht jede Anfrage erneut bei Google nachfragt.
const authCache = new Map();
async function checkGoogle(req) {
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

const txt = arr => (arr || []).map(t => t.plain_text).join('');
const plain = p => {
  if (!p) return '';
  switch (p.type) {
    case 'title':            return txt(p.title);
    case 'rich_text':        return txt(p.rich_text);
    case 'number':           return p.number;
    case 'select':           return p.select ? p.select.name : '';
    case 'multi_select':     return (p.multi_select || []).map(o => o.name);
    case 'status':           return p.status ? p.status.name : '';
    case 'date':             return p.date ? p.date.start : '';
    case 'url':              return p.url || '';
    case 'email':            return p.email || '';
    case 'phone_number':     return p.phone_number || '';
    case 'checkbox':         return p.checkbox;
    case 'relation':         return (p.relation || []).map(r => r.id);
    case 'people':           return (p.people || []).map(u => u.name || u.id);
    case 'created_time':     return p.created_time || '';
    case 'last_edited_time': return p.last_edited_time || '';
    case 'formula': {
      const f = p.formula || {};
      return f[f.type] == null ? '' : (f.type === 'date' ? (f.date && f.date.start) || '' : f[f.type]);
    }
    default:                 return '';
  }
};

// Seiteninhalt (z. B. Gesprächsprotokolle auf der Kundenseite) als einfacher Text.
async function pageText(id, headers) {
  const out = [];
  let cursor;
  for (let i = 0; i < 3; i++) {
    const q = new URLSearchParams({ page_size: '100' });
    if (cursor) q.set('start_cursor', cursor);
    const r = await fetch(`https://api.notion.com/v1/blocks/${id}/children?${q}`, { headers });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || 'Notion-Fehler');
    for (const b of j.results || []) {
      const v = b[b.type] || {};
      const t = txt(v.rich_text);
      if (b.type === 'child_page') out.push({ type: 'heading_3', text: v.title || '' });
      else if (b.type === 'divider') out.push({ type: 'divider', text: '' });
      else if (t) out.push({ type: b.type, text: t, checked: v.checked });
    }
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return out;
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(501).json({ error: 'NOTION_TOKEN ist in Vercel noch nicht hinterlegt' });

  try {
    const auth = await checkGoogle(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  } catch (e) {
    return res.status(502).json({ error: 'Google-Prüfung fehlgeschlagen: ' + e.message });
  }

  const { db, id, schema, content } = req.query || {};
  const dsId = DS[db];
  if (!dsId) return res.status(400).json({ error: 'Unbekannte Datenbank: ' + db });

  const headers = {
    Authorization: 'Bearer ' + token,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET' && schema) {
      const r = await fetch(`https://api.notion.com/v1/databases/${dsId}`, { headers });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: j.message || 'Notion-Fehler' });
      const props = {};
      for (const [k, v] of Object.entries(j.properties || {})) {
        const opts = (v[v.type] && v[v.type].options) || null;
        props[k] = { type: v.type, options: opts ? opts.map(o => ({ name: o.name, color: o.color })) : undefined };
      }
      return res.status(200).json({ props });
    }

    if (req.method === 'GET' && id && content) {
      return res.status(200).json({ blocks: await pageText(id, headers) });
    }

    if (req.method === 'GET') {
      const rows = [];
      let cursor;
      for (let i = 0; i < 5; i++) {
        const body = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const r = await fetch(`https://api.notion.com/v1/databases/${dsId}/query`, {
          method: 'POST', headers, body: JSON.stringify(body)
        });
        const j = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: j.message || 'Notion-Fehler' });
        for (const pg of j.results || []) {
          const out = { id: pg.id, url: pg.url, _edited: pg.last_edited_time, _created: pg.created_time };
          for (const [k, v] of Object.entries(pg.properties || {})) out[k] = plain(v);
          rows.push(out);
        }
        if (!j.has_more) break;
        cursor = j.next_cursor;
      }
      return res.status(200).json({ rows });
    }

    if (req.method === 'POST') {
      const body = { parent: { database_id: dsId }, properties: req.body.properties };
      if (Array.isArray(req.body.children)) body.children = req.body.children;
      const r = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: j.message || 'Notion-Fehler' });
      return res.status(200).json({ id: j.id, url: j.url });
    }

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id fehlt' });
      // Sicherheitsnetz: nur Seiten bearbeiten, die wirklich in der angefragten Datenbank liegen.
      const chk = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers });
      const pg = await chk.json();
      if (!chk.ok) return res.status(chk.status).json({ error: pg.message || 'Notion-Fehler' });
      const parent = ((pg.parent && pg.parent.database_id) || '').replace(/-/g, '');
      if (parent !== dsId.replace(/-/g, '')) return res.status(400).json({ error: 'Seite gehört nicht zu ' + db });
      const r = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ properties: req.body.properties })
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: j.message || 'Notion-Fehler' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
