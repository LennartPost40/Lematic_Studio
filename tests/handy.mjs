// Prüft die Handy-Oberfläche (v.55) bei 390 × 844: Tab-Leiste, Kalender mit Wochenstreifen, Aufgaben, Kunden, Mehr.
// Dazu ein Blick auf den Rechner (1440 × 900): dort darf nichts davon auftauchen.
// Aufruf: cd tests && npm i && PW_CHANNEL=chrome node handy.mjs   (SHOTS=<ordner> legt Bildschirmfotos ab)
import { start } from './harness.mjs';
import fs from 'fs';
let pass = 0, fail = 0;
const ok = (c, text, info = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FEHLER ') + text + (info !== '' ? '  → ' + info : '')) };
const wait = (p, ms) => p.waitForTimeout(ms);
const SHOTS = process.env.SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }) };

// Kein Querscrollen, keine überlappenden Bedienelemente im sichtbaren Bereich
const layout = (p, root) => p.evaluate(root => {
  const se = document.scrollingElement, wide = se.scrollWidth - innerWidth;
  const box = document.querySelector(root); if (!box) return { wide, bad: ['fehlt: ' + root] };
  const els = [...box.querySelectorAll('button,a,input,select,textarea,h1,h2,h3,.pill,.who2')].filter(e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && e.closest('[hidden]') === null && r.bottom > 0 && r.top < innerHeight;
  });
  const bad = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
    const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
    const x = Math.min(r.right, s.right) - Math.max(r.left, s.left), y = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (x > 2 && y > 2) bad.push((a.textContent || a.tagName).trim().slice(0, 24) + ' / ' + (b.textContent || b.tagName).trim().slice(0, 24));
  }
  // Ragt etwas über den Rand?
  const out = [...box.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed' && !e.closest('.seg,.legend,.kboard,[hidden]') }).map(e => e.className || e.tagName).slice(0, 4);
  return { wide, bad: bad.slice(0, 5), out };
}, root);
const lay = async (p, root, name) => { const l = await layout(p, root); ok(l.wide <= 0 && !l.bad.length && !l.out.length, name + ': kein Querscrollen, nichts überlappt', JSON.stringify(l)) };

const h = await start({ mobile: true }), p = h.page;
const notion = []; p.on('request', r => { if (r.url().includes('/api/notion') && r.method() !== 'GET') notion.push({ m: r.method(), u: r.url(), body: r.postData() || '' }) });
await h.login(); await wait(p, 1900); await h.tidy();

console.log('Start und Tab-Leiste');
ok(await p.evaluate(() => location.hash) === '#/kalender', 'Start nach dem Login ist der Kalender', await p.evaluate(() => location.hash));
const tb = await p.evaluate(() => [...document.querySelectorAll('.tabbar>a,.tabbar>button')].map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim() || e.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) } }));
ok(tb.length === 5, 'Tab-Leiste hat genau fünf Flächen', tb.map(x => x.t).join(' · '));
ok(tb.map(x => x.t).join('|') === 'Kalender|Aufgaben|Neu eintragen|Kunden|Mehr', 'Reihenfolge Kalender · Aufgaben · Plus · Kunden · Mehr');
ok(tb.every(x => x.w >= 44 && x.h >= 44), 'Alle Flächen mindestens 44 px', JSON.stringify(tb.map(x => x.w + 'x' + x.h)));
ok(await p.evaluate(() => { const o = document.querySelector('#tbPlus .tb-orb').getBoundingClientRect(); return Math.round(o.width) === 56 && Math.round(o.height) === 56 }), 'Plus ist 56 px groß');
ok(await p.evaluate(() => [...document.querySelectorAll('.mobile-brand')].every(m => !m.offsetParent)), 'Glocke und Zahnrad im Seitenkopf sind weg');
await p.click('#tbPlus'); await wait(p, 400);
ok(await p.evaluate(() => $('qsWrap').classList.contains('show') && QS.mode === 'termin' && QS.date === selDay), 'Plus im Kalender öffnet das Blatt für den gewählten Tag');
await p.keyboard.press('Escape'); await wait(p, 300);

console.log('Kalender');
await shot(p, 'kalender');
const strip = await p.evaluate(() => [...document.querySelectorAll('#calMDays .calm-d')].map(b => ({ h: Math.round(b.getBoundingClientRect().height), sel: b.classList.contains('sel'), d: b.dataset.calm, dot: !b.querySelector('i').hidden })));
ok(strip.length === 7 && strip.every(x => x.h === 66), 'Wochenstreifen: sieben Tage, je 66 px hoch', strip.map(x => x.h).join(','));
ok(strip.filter(x => x.sel).length === 1 && strip.find(x => x.sel).d === await p.evaluate(() => TODAY), 'Heute ist gewählt');
ok(strip.find(x => x.sel).dot && strip.some(x => !x.dot), 'Tage mit Einträgen haben einen Punkt, freie nicht');
ok(await p.evaluate(() => $('calMTitle').textContent === 'Heute' && !document.querySelector('[data-view="kalender"]>.topbar').offsetParent && !$('calMode').offsetParent), 'Groß „Heute“, alter Kopf und Umschalter Monat/Woche/Liste ausgeblendet');
const cards = await p.evaluate(() => ({ n: document.querySelectorAll('#calList .ag-first .dayev').length, h3: getComputedStyle(document.querySelector('#calList .dayev h3')).fontSize, who: !!document.querySelector('#calList .ag-first .dayev .who2'), next: (document.querySelector('#calList .ag-day:not(.ag-first)>h3') || {}).textContent || '', gelb: (document.querySelector('#calList .ag-tasks') || {}).textContent || '' }));
ok(cards.n === 2 && cards.h3 === '17px' && cards.who, 'Termine des Tags als Karten, Titel 17 px, wer steht drin', JSON.stringify(cards));
ok(/^Morgen/.test(cards.next), 'Darunter der Folgetag', cards.next);
ok(/Aufgaben heute fällig/.test(cards.gelb) && /überfällig/.test(cards.gelb), 'Gelbe Zeile zu fälligen Aufgaben', cards.gelb);
await lay(p, '[data-view="kalender"]', 'Kalender');
const d2 = strip[(strip.findIndex(x => x.sel) + 2) % 7].d;
await p.click(`#calMDays [data-calm="${d2}"]`); await wait(p, 300);
ok(await p.evaluate(d => selDay === d && document.querySelector('#calMDays .sel').dataset.calm === d, d2), 'Tippen auf einen Tag wählt ihn');
await p.click('#calMNext'); await wait(p, 300);
ok(await p.evaluate(d => selDay === addDays(d, 7), d2), 'Pfeil wechselt die Woche');
await p.evaluate(() => { const el = $('calMDays'), r = el.getBoundingClientRect(), y = r.top + 20; const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true })); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(120)], bubbles: true })) });
await wait(p, 300);
ok(await p.evaluate(d => selDay === addDays(d, 14), d2), 'Wischen nach links wechselt eine Woche weiter');
await p.click('#calMMon'); await wait(p, 400);
ok(await p.evaluate(() => $('calMonWrap').classList.contains('show') && document.querySelectorAll('#calMonGrid [data-cal]').length >= 28), 'Monat öffnet ein Blatt mit dem Monat');
await shot(p, 'kalender-monat');
const pick = await p.evaluate(() => addDays(TODAY, 1));
await p.click(`#calMonGrid [data-cal="${pick}"]`); await wait(p, 400);
ok(await p.evaluate(d => !$('calMonWrap').classList.contains('show') && selDay === d && $('calMTitle').textContent === 'Morgen', pick), 'Tippen auf einen Tag im Monat wählt ihn und schließt das Blatt');
await p.click('#calList .dayev'); await wait(p, 300);
ok(await p.evaluate(() => !!document.querySelector('.entry-pop')), 'Tippen auf einen Termin öffnet das Eintrags-Fenster');
await h.tidy(); await p.evaluate(() => { closeEntryPop && closeEntryPop() });

console.log('Umleitungen');
await h.go('heute', 600);
ok(await p.evaluate(() => location.hash) === '#/kalender', '#/heute landet auf #/kalender');
await h.go('agent', 600);
ok(await p.evaluate(() => location.hash === '#/agent' && document.querySelector('.view[data-view="agent"]').classList.contains('active')), '#/agent lädt weiter');

console.log('Aufgaben');
await h.go('aufgaben');
await shot(p, 'aufgaben');
const au = await p.evaluate(() => ({ add: !!$('addTask').offsetParent, who: [...document.querySelectorAll('#tWho button')].sort((a, b) => (+a.style.order) - (+b.style.order)).map(b => b.textContent).join('|'), proj: !!$('tProj').offsetParent, tt: getComputedStyle(document.querySelector('[data-view="aufgaben"] .task .tt')).fontSize, btns: [...document.querySelectorAll('[data-view="aufgaben"] .task .right .icon-btn')].some(b => b.offsetParent) }));
ok(!au.add, 'Eingabezeile oben ist ausgeblendet');
ok(au.who === 'Ich|Martin|Alle', 'Umschalter Ich | Martin | Alle', au.who);
ok(!au.proj, 'Kundenfilter steckt hinter „Filter“');
ok(au.tt === '16px' && !au.btns, 'Karten: Titel 16 px, keine drei Knöpfe in der Zeile', JSON.stringify(au));
await lay(p, '[data-view="aufgaben"]', 'Aufgaben');
await p.click('#tFilt'); await wait(p, 200);
ok(await p.evaluate(() => !!$('tProj').offsetParent && !!$('tDone').offsetParent), 'Filter zeigt Kunde und Erledigte');
await p.click('#tFilt');
const row = p.locator('[data-view="aufgaben"] .task').first(), rb = await row.boundingBox();
await p.mouse.click(rb.x + rb.width * .6, rb.y + rb.height / 2); await wait(p, 300);
const menu = await p.evaluate(() => [...document.querySelectorAll('.pop-menu .pm-i')].map(b => b.textContent.trim()));
ok(menu.includes('Verschieben oder übergeben') && menu.includes('Löschen') && menu.some(x => /Kalender/.test(x)), 'Tippen auf die Karte öffnet das Menü', menu.join(' · '));
await p.click('.pop-menu .pm-i >> text=Verschieben oder übergeben'); await wait(p, 300);
ok(await p.evaluate(() => [...document.querySelectorAll('.pop-menu .pm-i')].some(b => /Morgen/.test(b.textContent))), 'Verschieben zeigt Morgen, Übermorgen …');
await p.keyboard.press('Escape'); await wait(p, 200);
const t0 = await p.evaluate(() => document.querySelector('[data-view="aufgaben"] .task [data-task]').dataset.task);
const hit = await p.evaluate(() => { const c = document.querySelector('[data-view="aufgaben"] .task .chk').getBoundingClientRect(), r = document.querySelector('[data-view="aufgaben"] .task').getBoundingClientRect(); return { w: 52, h: Math.round(r.height), cx: c.left - r.left } });
ok(hit.h >= 44, 'Haken: Tippfläche mindestens 44 px hoch', JSON.stringify(hit));
await p.mouse.click(rb.x + 6, rb.y + rb.height - 6); await wait(p, 900);
ok(await p.evaluate(id => TASKS.find(t => t.id === id).done, t0), 'Linker Rand der Karte hakt die Aufgabe ab');
await p.click('#tbPlus'); await wait(p, 400);
ok(await p.evaluate(() => $('qsWrap').classList.contains('show') && QS.mode === 'aufgabe'), 'Plus auf „Aufgaben“ öffnet das Blatt als Aufgabe');
await p.keyboard.press('Escape'); await wait(p, 300);

console.log('Kunden');
await h.go('kunden');
await shot(p, 'kunden');
const kl = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#kGrid .km-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()), ov: !!$('kOverview').offsetParent, view: !!$('kView').offsetParent, search: !!$('kSearch').offsetParent }));
ok(kl.rows.length === 5 && kl.search, 'Liste statt Board, Suche oben', kl.rows.length + ' Zeilen');
ok(kl.rows.some(r => /Hafenwerk.*Dreh heute 09:00/.test(r)) && kl.rows.some(r => /Nordlicht.*Termin heute 16:00/.test(r)), 'Zeile zeigt den Termin heute', kl.rows.slice(0, 2).join(' | '));
ok(!kl.ov && !kl.view, 'Kennzahlen und Umschalter Board/Liste ausgeblendet');
await lay(p, '[data-view="kunden"]', 'Kunden');
await p.fill('#kSearch', 'nord'); await wait(p, 200);
ok(await p.evaluate(() => document.querySelectorAll('#kGrid .km-row').length) === 2, 'Suche filtert die Liste');
await p.fill('#kSearch', '');
await p.evaluate(() => { const k = KUNDEN.find(x => x.id === 'k1'); k.raw['Telefon'] = '040 123 456'; k.raw['Adresse'] = 'Am Hafen 1, 20457 Hamburg' });
await p.click('#kGrid [data-kopen="k1"]'); await wait(p, 600);
await shot(p, 'kundenkarte');
const kc = await p.evaluate(() => {
  const m = document.querySelector('#kdSheet .kmob'), acts = [...m.querySelectorAll('.km-act')];
  return { on: $('kdSheet').classList.contains('kd-m') && !!m.offsetParent, tabs: !!document.querySelector('#kdSheet .ktabs').offsetParent, acts: acts.map(a => a.textContent.trim() + '=' + a.getAttribute('href').split(':')[0]),
    secs: [...m.querySelectorAll('.km-sec>h3')].map(x => x.textContent).join('|'), ev: m.querySelectorAll('.km-ev').length, ts: m.querySelectorAll('.task').length };
});
ok(kc.on && !kc.tabs, 'Kundenkarte am Handy: Kurzkarte, Reiter versteckt');
ok(kc.acts.join(',') === 'Anrufen=tel,Mail=mailto,Route=https', 'Anrufen, Mail, Route', kc.acts.join(','));
ok(kc.secs === 'Termine|Aufgaben|Letzte Notiz' && kc.ev >= 1 && kc.ts >= 1, 'Termine, Aufgaben, letzte Notiz', JSON.stringify(kc));
await lay(p, '#kdSheet', 'Kundenkarte');
await p.evaluate(() => { const k = KUNDEN.find(x => x.id === 'k2'); delete k.raw['Adresse']; delete k.raw['Telefon'] });
await p.evaluate(() => openKunde('k2')); await wait(p, 400);
ok(await p.evaluate(() => [...document.querySelectorAll('#kdSheet .kmob .km-act')].map(a => a.textContent.trim()).join(',')) === 'Mail', 'Ohne Adresse fehlt die Fläche Route');
await p.evaluate(() => openKunde('k1')); await wait(p, 400);
const before = notion.length;
await p.fill('#kmNote', 'Will zwei Schnittfassungen');
ok(notion.length === before && await p.evaluate(() => !$('kmNoteGo').disabled), 'Notiz: nichts gespeichert vor „Speichern“');
await p.click('#kmNoteGo'); await wait(p, 600);
const sent = notion.slice(before);
ok(sent.length === 1 && sent[0].m === 'PATCH' && /kunden/.test(sent[0].u) && sent[0].body.includes('Will zwei Schnittfassungen'), 'Speichern schreibt die Notiz in die Kundenkarte', sent.map(x => x.m + ' ' + x.u.split('?')[1]).join(','));
ok(await p.evaluate(() => $('kmNote').value === '' && /Will zwei/.test(document.querySelector('.km-note').textContent)), 'Feld leer, Notiz steht als letzte Notiz');
ok(await p.evaluate(() => { const b = document.querySelector('.km-mic'); return !!b && b.dataset.for === 'kmNote' }), 'Notiz diktieren schreibt ins Notizfeld');
await p.click('[data-kmall]'); await wait(p, 300);
ok(await p.evaluate(() => !$('kdSheet').classList.contains('kd-m') && !!document.querySelector('#kdSheet .ktabs').offsetParent), '„Alles anzeigen“ öffnet die volle Karte mit Reitern');
await p.evaluate(() => closeKunde()); await wait(p, 200);

console.log('Mehr');
await p.click('#tbMore'); await wait(p, 400);
await shot(p, 'mehr');
const mehr = await p.evaluate(() => [...document.querySelectorAll('#moreGrid .mrow')].map(r => ({ t: r.querySelector('.ml').firstChild.textContent.trim(), sub: (r.querySelector('.ml small') || {}).textContent || '', h: Math.round(r.getBoundingClientRect().height) })));
const names = mehr.map(x => x.t);
ok(['Mitteilungen', 'Rechnungen', 'Analyse', 'Mails', 'Dateien', 'Angebotsrechner', 'Zuletzt gelöscht', 'Einstellungen'].every(n => names.includes(n)), 'Mehr: alle Bereiche als Liste', names.join(' · '));
ok(!names.includes('Intelligence') && !names.includes('Heute') && !names.includes('Kalender') && !names.includes('Kundenkartei'), 'Keine Intelligence, kein Heute, keine Tabs doppelt');
ok(mehr.find(x => x.t === 'Angebotsrechner').sub === 'Am Rechner bequemer', 'Angebotsrechner mit Unterzeile');
ok(mehr.filter(x => x.t !== 'Neu laden').every(x => x.h >= 60), 'Zeilen mindestens 60 px', mehr.map(x => x.h).join(','));
await lay(p, '.more-sheet', 'Mehr');
await p.click('[data-moreact="notes"]'); await wait(p, 400);
ok(await p.evaluate(() => $('noteWrap').classList.contains('show') && !$('moreWrap').classList.contains('show')), 'Mitteilungen öffnen aus „Mehr“');
await p.evaluate(() => closeNotes()); await wait(p, 200);
await p.click('#tbMore'); await wait(p, 300); await p.click('#moreGrid a[data-route="rechnungen"]'); await wait(p, 600);
ok(await p.evaluate(() => location.hash === '#/rechnungen' && !$('moreWrap').classList.contains('show') && $('tbMore').classList.contains('active')), 'Bereich aus „Mehr“ öffnet sich, „Mehr“ bleibt markiert');

ok(h.errs.length === 0, 'Keine Skriptfehler am Handy', h.errs.join(' | '));
await h.close();

console.log('Rechner bleibt, wie er ist');
const d = await start(), q = d.page;
await d.login(); await wait(q, 1900); await d.tidy();
ok(await q.evaluate(() => location.hash) === '#/heute', 'Start am Rechner bleibt „Heute“');
await d.go('kalender');
ok(await q.evaluate(() => !document.querySelector('.tabbar').offsetParent && !$('calM').offsetParent && !!document.querySelector('[data-view="kalender"]>.topbar').offsetParent && !!$('calMode').offsetParent), 'Kalender: kein Wochenstreifen, alter Kopf und Umschalter da');
await d.go('aufgaben');
ok(await q.evaluate(() => !$('tFilt').offsetParent && !!$('addTask').offsetParent && [...document.querySelectorAll('#tWho button')].map(b => b.textContent).join('|') === 'Alle|Lennart|Martin'), 'Aufgaben: Eingabezeile da, Umschalter wie bisher');
await d.go('kunden');
ok(await q.evaluate(() => !document.querySelector('#kGrid .km-row') && !!$('kView').offsetParent), 'Kunden: Board oder Liste wie bisher');
ok(d.errs.length === 0, 'Keine Skriptfehler am Rechner', d.errs.join(' | '));
await d.close();

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
