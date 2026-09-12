// Vercel Serverless Function: Proxy zwischen LeMatic Studio und Notion.
// Grund: Die Notion-API lässt sich aus dem Browser nicht direkt aufrufen (CORS),
// und der Token darf niemals im öffentlichen Frontend-Code stehen.
// Token in Vercel hinterlegen als Environment Variable: NOTION_TOKEN

// Wichtig: das sind die klassischen Datenbank-IDs (nicht die neueren "Data Source"-IDs,
// die Notion seit der Mehrfachquellen-Umstellung zusätzlich vergibt). Die Query- und
// Page-Erstellung der REST-API (Version 2022-06-28) erwartet diese Datenbank-IDs.
const DS = {
  aufgaben:   'cc64b42c-e0db-4186-a540-7c824cfa8bb1',
  rechnungen: 'b1b8239b-195c-47c2-b60c-007cb5c78b3d',
  akquise:    'c33aace4-5c10-42c7-88d6-08a9fb7af12d',
  projekte:   'ff5a312a-562f-48bb-a320-f32ab245ba81',
  kunden:     '1a47c61b-a5b6-416e-b4f2-d32454de35f2',
  laufwerke:  '0bba1261-69bd-49c1-ab22-beaf50ead987'
};

const plain = p => {
  if (!p) return '';
  switch (p.type) {
    case 'title':       return (p.title || []).map(t => t.plain_text).join('');
    case 'rich_text':   return (p.rich_text || []).map(t => t.plain_text).join('');
    case 'number':      return p.number;
    case 'select':      return p.select ? p.select.name : '';
    case 'status':      return p.status ? p.status.name : '';
    case 'date':        return p.date ? p.date.start : '';
    case 'url':         return p.url || '';
    case 'checkbox':    return p.checkbox;
    case 'relation':    return (p.relation || []).map(r => r.id);
    default:            return '';
  }
};

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(501).json({ error: 'NOTION_TOKEN ist in Vercel noch nicht hinterlegt' });

  const { db, id } = req.query || {};
  const dsId = DS[db];
  if (!dsId) return res.status(400).json({ error: 'Unbekannte Datenbank: ' + db });

  const headers = {
    Authorization: 'Bearer ' + token,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`https://api.notion.com/v1/databases/${dsId}/query`, {
        method: 'POST', headers, body: JSON.stringify({ page_size: 100 })
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: j.message || 'Notion-Fehler' });
      const rows = (j.results || []).map(pg => {
        const out = { id: pg.id, url: pg.url };
        for (const [k, v] of Object.entries(pg.properties || {})) out[k] = plain(v);
        return out;
      });
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
      return res.status(200).json({ rows });
    }

    if (req.method === 'POST') {
      const r = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST', headers,
        body: JSON.stringify({ parent: { database_id: dsId }, properties: req.body.properties })
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: j.message || 'Notion-Fehler' });
      return res.status(200).json({ id: j.id, url: j.url });
    }

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id fehlt' });
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
