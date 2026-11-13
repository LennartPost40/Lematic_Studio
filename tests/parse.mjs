// Prüft parseEntry() (v.54): Eintrag aus einer Zeile lesen. Läuft ohne Browser: cd tests && node parse.mjs
// Holt die Funktion direkt aus index.html (Block PARSE-START … PARSE-END) und guessArt() dazu.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const html = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const block = html.slice(html.indexOf('/* PARSE-START'), html.indexOf('/* PARSE-END */'));
const ga = /function guessArt\(t\)\{.*\}/.exec(html)[0];
const kunden = ['Hafenwerk GmbH', 'Nordlicht Events', 'Studio Elbe'];
const kundeIdForText = t => { t = String(t).toLowerCase(); const i = kunden.findIndex(k => t.includes(k.split(' ')[0].toLowerCase())); return i < 0 ? '' : 'k' + (i + 1) };
const parseEntry = new Function('kundeIdForText', ga + '\n' + block + '\nreturn (t,b,o)=>parseEntry(t,b,Object.assign({guessArt,kundeIdForText,me:"LP"},o));')(kundeIdForText);

let pass = 0, fail = 0;
// Fest: Freitag, 13.11.2026
const BASE = '2026-11-13';
const check = (text, want, base = BASE) => {
  const got = parseEntry(text, base);
  const bad = Object.keys(want).filter(k => got[k] !== want[k]);
  bad.length ? fail++ : pass++;
  console.log((bad.length ? '  FEHLER ' : '  ok   ') + JSON.stringify(text) + (bad.length ? '  → ' + bad.map(k => `${k}: ${JSON.stringify(got[k])} statt ${JSON.stringify(want[k])}`).join(', ') : ''));
};

console.log('Testfälle aus der Übergabe');
check('Dreh Hafenwerk 9-15 Uhr', { title: 'Dreh Hafenwerk', art: 'dreh', date: '', time: '09:00', timeEnd: '15:00', who: '', kid: 'k1' });
check('Call mit Jana morgen um 14 Uhr', { title: 'Call mit Jana', date: '2026-11-14', time: '14:00', timeEnd: '15:00', who: '' });
check('Angebot nachfassen Freitag', { title: 'Angebot nachfassen', art: 'aufgabe', date: '2026-11-20', time: '', who: 'LP' });
check('Schnitt Sa 10 bis 14 für Lennart', { title: 'Schnitt', art: 'schnitt', date: '2026-11-14', time: '10:00', timeEnd: '14:00', who: 'LP', whoFound: true });
check('Dreh 3 Kameras', { title: 'Dreh 3 Kameras', art: 'dreh', time: '', timeEnd: '', date: '' });
check('Belegt 20.11. bis 22.11.', { art: 'belegt', date: '2026-11-20', end: '2026-11-22', who: 'LP', time: '' });

console.log('Uhrzeiten');
check('Termin 09:00–15:30', { time: '09:00', timeEnd: '15:30', title: 'Termin' });
check('Meeting ab 10', { time: '10:00', timeEnd: '11:00', title: 'Meeting' });
check('Treffen 14:30', { time: '14:30', timeEnd: '15:30' });
check('Pitch 16 Uhr', { time: '16:00', timeEnd: '17:00', title: 'Pitch' });
check('Dreh 15-9', { time: '', title: 'Dreh 15-9' });
check('Aufgabe: Rechnung schreiben um 10', { art: 'aufgabe', time: '10:00', timeEnd: '', title: 'Rechnung schreiben' });

console.log('Tage');
check('Dreh heute', { date: '2026-11-13', title: 'Dreh' });
check('Schnitt übermorgen', { date: '2026-11-15' });
check('Call in 3 Tagen', { date: '2026-11-16' });
check('Dreh am Montag 8 Uhr', { date: '2026-11-16', time: '08:00', title: 'Dreh' });
check('Dreh Freitag', { date: '2026-11-20' }); // heute ist Freitag: der nächste
check('Dreh 14.11.2026', { date: '2026-11-14' });
check('Pitch am 5.1.', { date: '2027-01-05', title: 'Pitch' });
check('So schnell wie möglich Angebot schicken', { date: '', art: 'aufgabe' });
check('Dreh So 10 Uhr', { date: '2026-11-15', time: '10:00' });

console.log('Für wen, Rest');
check('Dreh für Martin morgen', { who: 'MS', whoFound: true, title: 'Dreh' });
check('Call zusammen mit Nordlicht', { who: '', whoFound: true, kid: 'k2' });
check('Studio Elbe anrufen', { art: 'aufgabe', who: 'LP', kid: 'k3' });
check('Dreh Kranbau nächste Woche', { rest: 'nächste Woche', title: 'Dreh Kranbau', date: '' });
check('Dreh im Laden', { art: 'dreh' });
check('', { title: '', date: '', time: '' });

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
