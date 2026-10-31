// Vercel Serverless Function: Claude im LeMatic Studio.
// Benötigt in Vercel die Environment Variable ANTHROPIC_API_KEY (console.anthropic.com → API Keys).
// Optional CLAUDE_MODEL, sonst claude-haiku-5-5 (günstigstes Modell, reicht für Entwürfe und Briefings).
// Nur eingeloggte lematic.de-Konten dürfen fragen; die Aufgaben sind fest vorgegeben,
// damit die Funktion kein allgemeiner, offener Chat-Proxy ist.
import { checkGoogle } from './_auth.js';

const SYSTEM = `Du bist "LeMatic Intelligence" (kurz LI), die Intelligenz im LeMatic Studio, dem internen Dashboard von LeMatic,
einer Hamburger Videoproduktion von Lennart und Martin (Event-Content, Same-Day-Reels, 3D-/KI-Produktfilme für Industrie,
Energie und Agenturen). Du sprichst als LeMatic Intelligence, in der Ich-Form, und stellst dich nur mit diesem Namen vor.
Nenne von dir aus keine KI-Anbieter, Modellnamen oder technischen Hintergründe; fragt jemand danach, sag, dass du die
KI-Assistenz von LeMatic bist und auf einem großen Sprachmodell basierst. Du bist eine KI, das verschweigst du nie.
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
${c.list}`,
  agent: c => `Du beantwortest Fragen zu LeMatic: Kunden, Akquise,
Aufgaben, Termine, Mails, Rechnungen und Angebote, wo etwas abgelegt ist und wie es sinnvoll weitergeht.
Regeln:
- Nutze nur das LeMatic-Wissen unten. Steht etwas nicht drin, sag das ehrlich und sag, wo man nachsehen könnte.
- Das Wissen enthält auch Treffer aus Google Drive und dem Postfach zur aktuellen Frage. Nutze sie, wenn sie passen,
  und nenne die Quelle als Markdown-Link [Dateiname](Link). Bei Fragen nach "wo liegt" immer den Ordner oder Link nennen.
- Bei Geldbeträgen gelten die Originale aus Drive. Rechne Summen sauber nach und nenne, welche Rechnungen eingeflossen sind.
- Private Dinge von Lennart oder Martin (eigene Jobs, private Projekte, private Kunden) gehören nicht zu LeMatic.
  Fragt jemand danach, sag kurz, dass du nur LeMatic kennst.
- Du bist LeMatic Intelligence. Sprich die fragende Person mit Vornamen an, wenn es passt.
- Antworte kurz und konkret, gern mit Stichpunkten, Namen und Daten. Bei "wie weiter"-Fragen: maximal 5 Schritte, mit wer und bis wann.
- Wenn eine Grafik hilft (Verlauf, Vergleich, Verteilung), hänge GENAU EINEN Block an, in diesem Format, mit echten Zahlen aus dem Wissen:
\`\`\`chart
{"type":"bar","title":"Kurzer Titel","labels":["A","B"],"values":[1,2],"unit":"€"}
\`\`\`
  type ist "bar" oder "line". Keine Zahlen erfinden.
- Du kannst Dinge erledigen. Wenn die Person etwas anlegen, verschieben, abhaken, löschen oder notieren will, beschreibe
  in einem Satz, was du vorschlägst, und hänge GENAU EINEN Block an (die Person bestätigt danach per Knopf, du führst nichts selbst aus):
\`\`\`actions
[{"type":"task_create","title":"...","who":"LP oder MS","due":"JJJJ-MM-TT","time":"HH:MM oder leer","kunde_id":"ID oder leer"},
 {"type":"task_done","id":"Aufgabe-ID"},{"type":"task_move","id":"Aufgabe-ID","due":"JJJJ-MM-TT","time":"HH:MM oder leer"},
 {"type":"task_delete","id":"Aufgabe-ID"},
 {"type":"event_create","title":"...","date":"JJJJ-MM-TT","time":"HH:MM oder leer","dauer_min":60,"ort":"","kunde_id":""},
 {"type":"event_move","id":"Termin-ID","date":"JJJJ-MM-TT","time":"HH:MM oder leer"},
 {"type":"note_add","kunde_id":"Kunde-ID","text":"..."}]
\`\`\`
  Nur die Einträge, die wirklich gebraucht werden. IDs exakt aus dem Wissen übernehmen, nie erfinden; findest du die passende
  Aufgabe oder den Termin nicht, frag nach. "who": Lennart = LP, Martin = MS; ohne Angabe die fragende Person.
  Relative Angaben wie "morgen" oder "Freitag" vom heutigen Datum aus ausrechnen.
Fragt gerade: ${c.user || 'jemand aus dem Team'}. Heute ist ${c.heute || ''}.
--- LeMatic-Wissen ---
${c.wissen}
--- Bisheriges Gespräch ---
${c.verlauf || '(neu)'}
--- Neue Frage ---
${c.frage}`,
  beleg: c => `Lies den Beleg und gib NUR ein JSON-Objekt zurück, ohne Text davor oder danach:
{"art":"Eingang|Ausgang|Angebot","partei":"Firmenname des Lieferanten bzw. Kunden","nummer":"Rechnungsnummer oder leer",
"datum":"JJJJ-MM-TT","betrag":Bruttobetrag als Zahl,"faellig":"JJJJ-MM-TT (Fälligkeitsdatum; steht nur ein Zahlungsziel in Tagen da, z. B. zahlbar innerhalb von 30 Tagen, dann Rechnungsdatum plus diese Tage) oder leer",
"kategorie":"Equipment|Programme|Domain|Buchhaltung|Sonstiges","beschreibung":"max. 8 Wörter, was gekauft/geleistet wurde"}
LeMatic (Lennart Post / Martin Schmick, Geesthacht) ist der Empfänger, wenn es eine Eingangsrechnung ist.
Kategorien: Equipment = Kamera, Licht, Ton, Technik; Programme = Software, Abos, KI-Tools; Domain = Domain, Hosting, Server;
Buchhaltung = Steuer, Buchhaltung, Versicherung, Bank; sonst Sonstiges.
${c.text ? '--- Text des Belegs ---\n' + c.text : '(Beleg als Datei angehängt)'}`,
  insights: c => `Unten stehen die aktuellen Kennzahlen von LeMatic, aus denen gerade Grafiken gezeichnet werden.
Werte sie aus: 3 bis 4 Erkenntnisse, je eine Zeile, beginnend mit einem passenden Emoji. Danach eine Zeile
"Empfehlung: ..." mit dem wichtigsten nächsten Schritt. Nur was aus den Zahlen wirklich folgt, keine Floskeln.
${c.zahlen}`,
  tipps: c => `Du gibst ${c.user || 'dem Team'} heute persönliche Empfehlungen im LeMatic Studio. Drei Arten:
- "heute": eine konkrete Sache, die heute oder diese Woche wirklich etwas bringt (Geld, Kunde, Frist). Mit Namen, Beträgen, Daten aus den Daten.
- "firma": eine Verbesserung am Unternehmen LeMatic (Akquise, Preise, Abläufe, Positionierung, wiederkehrende Probleme), begründet mit dem, was in den Daten auffällt.
- "studio": wie ${c.user || 'der Nutzer'} das Studio besser nutzen kann oder was am Studio fehlt bzw. nervt, abgeleitet aus dem Nutzungsverhalten (welche Bereiche oft/nie genutzt werden, wonach gesucht wird, wo Fehler auftreten).
Gib 4 Empfehlungen: 2x "heute", 1x "firma", 1x "studio". Keine Allgemeinplätze, nichts erfinden, nichts was die Person schon erledigt hat.
Lerne aus dem Feedback: Ähnliches wie "hilfreich" gern wieder, Themen mit "passt nicht" meiden, schon Vorgeschlagenes nicht wiederholen.
Gib NUR ein JSON-Array zurück, ohne Text davor oder danach:
[{"art":"heute|firma|studio","titel":"max 8 Wörter","text":"1-2 Sätze, konkret","warum":"kurze Begründung aus den Daten, max 15 Wörter","aktion":{"typ":"frage","text":"Frage an LeMatic Intelligence, die das direkt angeht"} oder {"typ":"seite","ziel":"rechnungen|kunden|aufgaben|angebot|kalender|akquise|mails|agent"}}]
Heute: ${c.heute}
--- Nutzung des Studios (letzte Wochen) ---
${c.nutzung}
--- Feedback zu früheren Empfehlungen ---
${c.feedback || '(noch keins)'}
--- Daten von LeMatic ---
${c.wissen}`
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
  if (!key) return res.status(501).json({ error: 'LeMatic Intelligence ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt)' });

  const { task, context } = req.body || {};
  const build = TASKS[task];
  if (!build || !context || typeof context !== 'object') return res.status(400).json({ error: 'Unbekannte Aufgabe' });
  const clip = v => String(v == null ? '' : v).slice(0, task === 'agent' ? 60000 : task === 'tipps' ? 30000 : 12000);
  // Beleg als Datei (Foto oder gescanntes PDF): separat, nicht abschneiden
  const file = task === 'beleg' && typeof context.file === 'string' && context.file.length < 6_000_000 ? context.file : null;
  const mime = String(context.mime || '');
  const ctx = Object.fromEntries(Object.entries(context).filter(([k]) => k !== 'file').map(([k, v]) => [k, clip(v)]));
  const prompt = build(ctx);
  const content = file
    ? [/pdf/.test(mime)
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file } }
        : { type: 'image', source: { type: 'base64', media_type: /png/.test(mime) ? 'image/png' : /webp/.test(mime) ? 'image/webp' : 'image/jpeg', data: file } },
       { type: 'text', text: prompt }]
    : prompt;

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        // Denkzeit zählt zu max_tokens. Haiku denkt sonst von selbst und verbraucht das Budget,
        // dann kommt eine abgeschnittene oder leere Antwort. Für Entwürfe und Kartei-Fragen reicht es ohne.
        ...(/haiku/.test(model) ? { thinking: { type: 'disabled' } } : {}),
        max_tokens: /haiku/.test(model) ? 2500 : 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content }]
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (j.error && j.error.message) || 'LeMatic Intelligence nicht erreichbar' });
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return res.status(502).json({ error: 'Leere Antwort (' + (j.stop_reason || 'unbekannt') + '). Bitte noch einmal fragen.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
