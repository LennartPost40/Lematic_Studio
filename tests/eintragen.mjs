// Prüft das neue Eintragen (v.54): Zeile am Rechner, Blatt am Handy, Sprechen mit „Verstanden als“.
// Aufruf: cd tests && npm i && PW_CHANNEL=chrome node eintragen.mjs
import { start } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, text, info = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FEHLER ') + text + (info !== '' ? '  → ' + info : '')) };
const wait = (p, ms) => p.waitForTimeout(ms);
const boot = async o => { const h = await start(o); await h.login(); await wait(h.page, 1900); await h.tidy(); return h };
// Schreibzugriffe mitschreiben: Kalender und Notion
const spy = p => { const w = []; p.on('request', r => { const u = r.url(), m = r.method(); if (m === 'GET') return; if (u.includes('/calendar/v3/')) w.push({ to: 'kal', m, u, body: r.postData() || '' }); else if (u.includes('/api/notion')) w.push({ to: 'notion', m, u, body: r.postData() || '' }) }); return w };
const since = (w, n) => w.slice(n).filter(x => x.m !== 'DELETE');

{ console.log('Rechner: eine Zeile am Tag');
  const h = await boot(), p = h.page, w = spy(p);
  const T = await p.evaluate(() => ({ today: TODAY, morgen: addDays(TODAY, 1) }));
  await h.go('kalender'); await p.click('#calMode [data-cm="month"]'); await wait(p, 100);
  await p.click(`#month [data-cal="${T.today}"] .dn`); await wait(p, 250);
  const st = await p.evaluate(() => ({ pop: !!document.querySelector('.qe-pop'), focus: document.activeElement && document.activeElement.id, dlg: document.getElementById('eventWrap').classList.contains('show'), w: document.querySelector('.qe-pop') && Math.round(document.querySelector('.qe-pop').getBoundingClientRect().width) }));
  ok(st.pop && !st.dlg, 'Klick auf den Tag öffnet das kleine Fenster, nicht den großen Dialog');
  ok(st.focus === 'qeText', 'Fokus steht sofort im Eingabefeld', st.focus);
  ok(st.w === 460, 'Fenster ist 460 px breit', st.w);
  await p.keyboard.type('Dreh Hafenwerk 9-15 Uhr für Martin'); await wait(p, 120);
  const tags = await p.evaluate(() => [...document.querySelectorAll('#qeFound .qe-tag')].map(x => x.textContent));
  ok(['Dreh', '09:00–15:00', 'Martin', 'Hafenwerk GmbH'].every(t => tags.includes(t)), 'Erkannt: Art, Uhrzeit, für wen, Kunde', tags.join(' | '));
  ok(await p.evaluate(() => document.querySelector('[data-qeart="dreh"]').classList.contains('on') && document.querySelector('[data-qewho="MS"]').getAttribute('aria-pressed') === 'true'), 'Reihen Art und Für zeigen das Erkannte');
  const n0 = w.length; await p.keyboard.press('Enter'); await wait(p, 700);
  const r = since(w, n0);
  ok(r.length === 1 && r[0].to === 'kal' && r[0].m === 'POST', 'Enter legt genau einen Termin an', r.map(x => x.to + ' ' + x.m).join(', '));
  if (r[0]) { const b = JSON.parse(r[0].body);
    ok(b.start.dateTime === T.today + 'T09:00:00' && b.end.dateTime === T.today + 'T15:00:00', 'Start und Ende stimmen', b.start.dateTime + ' – ' + b.end.dateTime);
    ok(b.extendedProperties.private.lmWho === 'MS' && b.extendedProperties.private.lmArt === 'dreh' && b.summary === 'Dreh Hafenwerk', 'lmWho, Art und Titel stimmen', b.summary + ' · ' + b.extendedProperties.private.lmWho);
  }
  ok(await p.evaluate(() => !document.querySelector('.qe-pop')), 'Fenster ist danach zu');

  // Esc schließt, nichts wird angelegt
  await p.click(`#month [data-cal="${T.today}"] .dn`); await wait(p, 200);
  const n1 = w.length; await p.keyboard.type('Test Esc'); await p.keyboard.press('Escape'); await wait(p, 200);
  ok(await p.evaluate(() => !document.querySelector('.qe-pop')) && since(w, n1).length === 0, 'Esc schließt, nichts angelegt');

  // Mehr Angaben: großer Dialog mit allem vorbelegt
  await h.tidy(); await p.click('#openEvent'); await wait(p, 200);
  await p.keyboard.type('Call Studio Elbe morgen um 14 Uhr'); await wait(p, 100); await p.click('#qeMore'); await wait(p, 300);
  const dl = await p.evaluate(() => ({ show: document.getElementById('eventWrap').classList.contains('show'), t: $('evTitle').value, d: $('evDate').value, ti: $('evTime').value, te: $('evTimeEnd').value, k: $('evKunde').value, art: EVD.art }));
  ok(dl.show && dl.t === 'Call Studio Elbe' && dl.d === T.morgen && dl.ti === '14:00' && dl.te === '15:00' && dl.k === 'k3', '„Mehr Angaben“ öffnet den großen Dialog vorbelegt', JSON.stringify(dl));
  await p.click('#evCancel'); await wait(p, 300);

  // Aufgabe in der Zeile: geht nach Notion, nicht in den Kalender
  await h.tidy(); await p.click('#openEvent'); await wait(p, 200);
  const n2 = w.length; await p.keyboard.type('Angebot Nordlicht nachfassen morgen'); await wait(p, 100);
  ok(await p.evaluate(() => document.querySelector('[data-qeart="aufgabe"]').classList.contains('on')), 'Tätigkeitswort macht eine Aufgabe');
  await p.keyboard.press('Enter'); await wait(p, 700);
  const r2 = since(w, n2);
  ok(r2.length === 1 && r2[0].to === 'notion', 'Aufgabe: ein Eintrag in Notion, keiner im Kalender', r2.map(x => x.to).join(','));

  // Woche: Klick in eine Stunde übernimmt die Uhrzeit
  await p.click('#calMode [data-cm="week"]'); await wait(p, 200);
  const frei = await p.evaluate(() => addDays(TODAY, 2)); // Tag ohne Termine
  const col = p.locator(`#week7 [data-wkcol="${frei}"]`); const bb = await col.boundingBox();
  await p.evaluate(() => { const s = document.querySelector('#week7 .wk-scroll'); s.scrollTop = 0 });
  const y0 = (await col.boundingBox()).y; await p.mouse.click(bb.x + bb.width / 2, y0 + 56 * 4 + 10); await wait(p, 250);
  const n3 = w.length; await p.keyboard.type('Schnitt Recap'); await p.keyboard.press('Enter'); await wait(p, 700);
  const r3 = since(w, n3); const b3 = r3[0] ? JSON.parse(r3[0].body) : null;
  ok(b3 && b3.start.dateTime === frei + 'T11:00:00' && b3.extendedProperties.private.lmArt === 'schnitt', 'Woche: Uhrzeit aus dem Klick, Art aus dem Text', b3 ? b3.start.dateTime + ' ' + b3.extendedProperties.private.lmArt : 'kein Eintrag');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}

{ console.log('Handy 390 × 844: Blatt');
  const h = await boot({ mobile: true }), p = h.page, w = spy(p);
  const T = await p.evaluate(() => ({ today: TODAY, morgen: addDays(TODAY, 1) }));
  await h.go('kalender'); await h.tidy(); await p.click('#openEvent'); await wait(p, 500);
  ok(await p.evaluate(() => document.getElementById('qsWrap').classList.contains('show') && !document.getElementById('eventWrap').classList.contains('show')), 'Plus öffnet das neue Blatt');
  const geo = await p.evaluate(() => {
    const sh = document.querySelector('#qsWrap .sheet'), vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' };
    const small = [...sh.querySelectorAll('button,input,select,textarea')].filter(vis).map(e => (e.type === 'checkbox' || e.type === 'time' || e.type === 'date') && e.closest('label') ? e.closest('label') : e).filter(e => e.getBoundingClientRect().height < 44).map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
    const r = sh.getBoundingClientRect();
    return { small, noX: document.documentElement.scrollWidth <= innerWidth && sh.scrollWidth <= sh.clientWidth, fits: sh.scrollHeight <= sh.clientHeight + 1 && r.bottom <= innerHeight + 1, h: Math.round(r.height), go: Math.round($('qsGo').getBoundingClientRect().height), title: getComputedStyle($('qsText')).fontSize, mic: Math.round($('qsMic').getBoundingClientRect().width) };
  });
  ok(geo.small.length === 0, 'Keine Tippfläche unter 44 px', geo.small.join(', '));
  ok(geo.noX, 'Kein Querscrollen');
  ok(geo.fits, 'Alles ohne Scrollen erreichbar, solange „Mehr Angaben“ zu ist', 'Blatt ' + geo.h + ' px');
  ok(geo.go === 54 && geo.title === '18px' && geo.mic === 48, 'Anlegen 54 px, Titel 18 px, Sprechen 48 px', `${geo.go} / ${geo.title} / ${geo.mic}`);

  // Tippen setzt die Flächen um
  await p.fill('#qsText', 'Dreh Kranbau morgen 9-15 Uhr'); await wait(p, 100);
  const s1 = await p.evaluate(D => ({ morgen: document.querySelector(`[data-qsday="${D}"]`).getAttribute('aria-pressed'), von: $('qsFrom').value, bis: $('qsTo').value, beide: document.querySelector('[data-qswho=""]').getAttribute('aria-pressed') }), T.morgen);
  ok(s1.morgen === 'true' && s1.von === '09:00' && s1.bis === '15:00' && s1.beide === 'true', 'Text setzt Morgen, Von, Bis und Beide sichtbar', JSON.stringify(s1));
  await p.click('[data-qsdur="120"]'); await p.click('[data-qswho="MS"]'); await wait(p, 80);
  ok(await p.evaluate(() => $('qsTo').value === '11:00'), 'Dauer „2 Std“ setzt Bis');
  const n0 = w.length; await p.click('#qsGo'); await wait(p, 700);
  const r = since(w, n0); const b = r[0] ? JSON.parse(r[0].body) : null;
  ok(r.length === 1 && r[0].to === 'kal' && b.start.dateTime === T.morgen + 'T09:00:00' && b.end.dateTime === T.morgen + 'T11:00:00' && b.extendedProperties.private.lmWho === 'MS', 'Anlegen: ein Termin mit Start, Ende und für Martin', b ? b.start.dateTime + '–' + b.end.dateTime + ' ' + b.extendedProperties.private.lmWho : r.length);
  ok(await p.evaluate(() => !document.getElementById('qsWrap').classList.contains('show')), 'Blatt ist danach zu');

  // Aufgabe: ein POST an Notion, keiner an den Kalender
  await h.tidy(); await p.click('#openEvent'); await wait(p, 400);
  await p.click('[data-qsmode="aufgabe"]'); await wait(p, 80);
  ok(await p.evaluate(() => !$('qsCalL').hidden && !$('qsCal').checked && $('qsTimes').hidden && !document.querySelector('[data-qswho=""]')), 'Aufgabe: Schalter „Auch in den Kalender“ aus, keine Zeiten, kein „Beide“');
  await p.fill('#qsText', 'Rechnung Studio Elbe schreiben'); const n1 = w.length; await p.click('#qsGo'); await wait(p, 700);
  const r1 = since(w, n1);
  ok(r1.length === 1 && r1[0].to === 'notion' && r1[0].m === 'POST', 'Aufgabe: ein POST an /api/notion, keiner an den Kalender', r1.map(x => x.to + ' ' + x.m).join(','));

  // Mehr Angaben klappt im selben Blatt auf
  await h.tidy(); await p.click('#openEvent'); await wait(p, 400); await p.click('#qsMoreBtn'); await wait(p, 80);
  ok(await p.evaluate(() => !$('qsMore').hidden && !!document.querySelector('#qsArts [data-qsart="belegt"]') && !$('qsOrtL').hidden && !$('qsKundeL').hidden), '„Mehr Angaben“ zeigt Art, Ort, Kunde, Notiz im Blatt');

  // Sprechen: „Verstanden als“, angelegt wird erst mit Anlegen
  const n2 = w.length;
  await p.evaluate(() => qsUnderstood('Schnitt Messefilm übermorgen 10 bis 12 für Martin')); await wait(p, 200);
  const card = await p.evaluate(() => ({ vis: !$('qsVoice').hidden && $('qsForm').hidden, txt: $('qsCard').textContent, hint: document.querySelector('.qs-hint').textContent }));
  ok(card.vis && /Schnitt Messefilm/.test(card.txt) && /10:00–12:00/.test(card.txt) && /Martin/.test(card.txt) && /Schnitt/.test(card.txt), 'Verstanden als: Titel, Wann, Für, Art', card.txt.replace(/\s+/g, ' ').slice(0, 140));
  ok(/nichts eingetragen, bevor du auf Anlegen tippst/.test(card.hint) && since(w, n2).length === 0, 'Vor „Anlegen“ wird nichts eingetragen');
  await p.click('#qsVGo'); await wait(p, 700);
  ok(since(w, n2).length === 1 && since(w, n2)[0].to === 'kal', 'Nach „Anlegen“ genau ein Termin');

  // Ohne Datum fragt das Blatt einmal die Intelligence; ohne Antwort bleibt das eigene Ergebnis
  await h.tidy(); await p.click('#openEvent'); await wait(p, 400);
  const n3 = w.length; await p.evaluate(() => qsUnderstood('Hofladen anrufen')); await wait(p, 600);
  const c2 = await p.evaluate(() => ({ txt: $('qsCard').textContent, act: !$('qsVAct').hidden }));
  ok(c2.act && /Hofladen anrufen/.test(c2.txt) && /Aufgabe/.test(c2.txt) && since(w, n3).length === 0, 'Ohne Antwort der Intelligence bleibt das eigene Ergebnis stehen', c2.txt.replace(/\s+/g, ' ').slice(0, 120));
  await p.click('#qsEdit'); await wait(p, 100);
  ok(await p.evaluate(() => !$('qsForm').hidden && $('qsText').value === 'Hofladen anrufen' && document.querySelector('[data-qsmode="aufgabe"]').getAttribute('aria-pressed') === 'true'), '„Ändern“ führt zurück ins Blatt, alles vorbelegt');
  await p.keyboard.press('Escape'); await wait(p, 300);
  ok(await p.evaluate(() => !document.getElementById('qsWrap').classList.contains('show')), 'Esc schließt das Blatt');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
