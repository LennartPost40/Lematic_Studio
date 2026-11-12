// Prüft „ein Kalender für beide“ (v.53): an jedem Termin steht, wer drin ist, und es gehen keine Kalender-Einladungen mehr raus.
// Aufruf: cd tests && npm i && PW_CHANNEL=chrome node kalender.mjs
import { start } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, text, info = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FEHLER ') + text + (info !== '' ? '  → ' + info : '')) };
const wait = (p, ms) => p.waitForTimeout(ms);

const h = await start(), p = h.page;
// Alle Schreibzugriffe auf den Kalender mitschreiben
const calReq = [];
p.on('request', r => { const u = r.url(); if (u.includes('/calendar/v3/') && r.method() !== 'GET') calReq.push({ m: r.method(), u, body: r.postData() || '' }) });
await h.login(); await wait(p, 1900); await h.tidy();
// WhatsApp-Hinweise mitschreiben statt in Drive abzulegen
await p.evaluate(() => { window.__wa = []; window.waNotify = async (who, title, when) => { window.__wa.push({ who, title }) } });

console.log('Wer steht im Termin');
await h.go('kalender'); await p.click('#calMode [data-cm="list"]'); await wait(p, 100);
const list = await p.evaluate(() => {
  const row = t => [...document.querySelectorAll('#calList .dayev')].find(b => b.textContent.includes(t));
  const info = t => { const r = row(t); if (!r) return null; const w = r.querySelector('.who2'); return { n: w ? w.querySelectorAll('.av').length : 0, label: w ? w.getAttribute('aria-label') : '', role: w ? w.getAttribute('role') : '' } };
  return { beide: info('Call Nordlicht'), lp: info('Dreh Hafenwerk'), alle: [...document.querySelectorAll('#calList .dayev')].filter(b => !b.classList.contains('de-aufgabe')).every(b => b.querySelector('.who2')) };
});
ok(list.beide && list.beide.n === 2 && list.beide.label === 'Lennart und Martin' && list.beide.role === 'img', 'Liste: Termin für beide zeigt zwei Kürzel', JSON.stringify(list.beide));
ok(list.lp && list.lp.n === 1 && list.lp.label === 'Lennart', 'Liste: Termin für Lennart zeigt eines', JSON.stringify(list.lp));
ok(list.alle, 'Liste: an jedem Termin steht jemand');

await p.click('#calMode [data-cm="month"]'); await wait(p, 100);
const mon = await p.evaluate(() => {
  const chip = t => [...document.querySelectorAll('#month .ev')].find(c => c.textContent.includes(t));
  const em = t => { const c = chip(t); const e = c && c.querySelector('em'); return e ? e.textContent : null };
  const bel = chip('Urlaub');
  return { beide: em('Call Nordlicht'), lp: em('Dreh Hafenwerk'), belegt: bel ? bel.querySelectorAll('em').length : -1 };
});
ok(mon.beide === 'LP · MS', 'Monat: Termin für beide zeigt „LP · MS“', mon.beide);
ok(mon.lp === 'LP', 'Monat: Termin für Lennart zeigt „LP“', mon.lp);

await p.click('#calMode [data-cm="week"]'); await wait(p, 100);
ok(await p.evaluate(() => { const e = [...document.querySelectorAll('#week7 .wk-ev')].find(x => x.textContent.includes('Call Nordlicht')); return !!e && /LP · MS/.test(e.textContent) }), 'Woche: Termin für beide zeigt „LP · MS“');

console.log('Keine Einladung, WhatsApp-Hinweis bleibt');
ok(await p.evaluate(() => !document.getElementById('evInvL') && !document.getElementById('evInvite')), 'Dialog: Haken „Per Kalender-Einladung erinnern“ ist weg');
const anlegen = async (pre) => {
  const n0 = calReq.length;
  await p.evaluate(pre => { openEventDialog(Object.assign({ art: 'termin', date: TODAY, time: '10:00', timeEnd: '11:00' }, pre)) }, pre);
  await wait(p, 300); await p.click('#evGo'); await wait(p, 700);
  return calReq.slice(n0);
};
const r1 = await anlegen({ title: 'Test für Martin', who: 'MS' });
ok(r1.length === 1 && r1[0].m === 'POST', 'Termin für Martin: genau ein Eintrag im Kalender', r1.map(x => x.m).join(','));
ok(r1.every(x => !x.u.includes('sendUpdates=all') && !x.body.includes('attendees')), 'Termin für Martin: keine Einladung', r1.map(x => x.u.split('/events')[1]).join(','));
ok(r1.length === 1 && JSON.parse(r1[0].body).extendedProperties.private.lmWho === 'MS', 'Termin für Martin: lmWho ist MS');
const r2 = await anlegen({ title: 'Test für beide', who: '' });
ok(r2.length === 1 && r2.every(x => !x.u.includes('sendUpdates') && !x.body.includes('attendees')), 'Termin für beide: keine Einladung');
await anlegen({ title: 'Test nur ich', who: 'LP' });
const wa = await p.evaluate(() => window.__wa);
ok(wa.some(w => w.who === 'MS' && w.title === 'Test für Martin') && wa.some(w => w.who === 'MS' && w.title === 'Test für beide') && !wa.some(w => w.title === 'Test nur ich'), 'WhatsApp-Hinweis bei „für Martin“ und „für beide“, nicht bei „nur ich“', JSON.stringify(wa));

const r3 = await (async () => { const n0 = calReq.length; await p.evaluate(async () => { const t = TASKS.find(x => x.who === 'MS' && !x.cal); await taskCalCreate(t) }); await wait(p, 300); return calReq.slice(n0) })();
ok(r3.length === 1 && !r3[0].u.includes('sendUpdates') && !r3[0].body.includes('attendees'), 'Aufgabe für Martin in den Kalender: keine Einladung');

const r4 = await (async () => { const n0 = calReq.length; const res = await p.evaluate(async () => liRunAction({ type: 'event_create', title: 'Intelligence-Termin', date: TODAY, time: '12:00', time_end: '13:00', art: 'termin', who: 'MS' })); await wait(p, 300); return { res, req: calReq.slice(n0) } })();
ok(r4.res === 'angelegt' && r4.req.length === 1 && !r4.req[0].u.includes('sendUpdates') && !r4.req[0].body.includes('attendees'), 'Intelligence legt an: keine Einladung', String(r4.res));

ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
