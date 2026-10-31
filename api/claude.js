// Vercel Serverless Function: Claude im LeMatic Studio.
// Benötigt in Vercel die Environment Variable ANTHROPIC_API_KEY (console.anthropic.com → API Keys).
// Optional CLAUDE_MODEL, sonst claude-haiku-5-5 (günstigstes Modell, reicht für Entwürfe und Briefings).
// Nur eingeloggte lematic.de-Konten dürfen fragen; die Aufgaben sind fest vorgegeben,
// damit die Funktion kein allgemeiner, offener Chat-Proxy ist.
import { checkGoogle } from './_auth.js';

const SYSTEM = `Du bist der interne Assistent von LeMatic, einer Hamburger Videoproduktion von Lennart und Martin
(Event-Content, Same-Day-Reels, 3D-/KI-Produktfilme für Industrie, Energie und Agenturen).
Schreib auf Deutsch, knapp, konkret, ohne Floskeln. Erfinde nichts: Wenn eine Information im Kontext fehlt,
sag das oder lass sie weg. Keine Preise oder Zusagen erfinden.`;

const TASKS = {
  reply: c => `Entwirf eine Antwort-Mail im Namen von ${c.from || 'Martin'} (LeMatic, info@lematic.de) auf die Mail unten.
Ton: freundlich, professionell, persönlich, kurz (max. 120 Wörter). Siezen, außer die eingehende Mail duzt.
Nutze den Kundenkontext nur, wenn er passt. Gib NUR den Mailtext aus (Anrede bis Gruß), ohne Betreffzeile.
${c.hint ? 'Worauf die Antwort hinauslaufen soll: ' + c.hint + '\n' : ''}
--- Eingehende Mail ---
Von: ${c.mailFrom}
Betreff: ${c.subject}
${c.body}
--- Kundenkontext ---
${c.kunde || '(kein Kunde zugeordnet)'}`,
  brief: c => `Mach ein Kunden-Briefing für ein Gespräch heute. Struktur, jeweils kurz:
1. Wo stehen wir (2–3 Sätze)
2. Offene Punkte (Stichpunkte)
3. Nächster sinnvoller Schritt (ein Satz, konkret)
4. Worauf im Gespräch achten (max. 3 Stichpunkte)
--- Kundenkontext ---
${c.kunde}`,
  radar: c => `Hier sind Kunden, bei denen länger nichts passiert ist. Schlag für jeden in einer Zeile vor,
mit welchem konkreten Aufhänger Martin sich melden kann (z. B. neue Referenz, Messe, Saison, offener Punkt).
Format pro Zeile: "Name: Vorschlag". Max. 8 Zeilen.
${c.list}`
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode nicht erlaubt' });
  try {
    const auth = await checkGoogle(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  } catch (e) {
    return res.status(502).json({ error: 'Google-Prüfung fehlgeschlagen: ' + e.message });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: 'ANTHROPIC_API_KEY ist in Vercel noch nicht hinterlegt' });

  const { task, context } = req.body || {};
  const build = TASKS[task];
  if (!build || !context || typeof context !== 'object') return res.status(400).json({ error: 'Unbekannte Aufgabe' });
  const clip = v => String(v == null ? '' : v).slice(0, 12000);
  const ctx = Object.fromEntries(Object.entries(context).map(([k, v]) => [k, clip(v)]));

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: 'user', content: build(ctx) }]
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (j.error && j.error.message) || 'Claude-Fehler' });
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
