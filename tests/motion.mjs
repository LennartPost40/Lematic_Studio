// Prüft die Bewegung im Studio (MOTION-Block). Aufruf: cd tests && npm i && npx playwright install chromium && node motion.mjs
import { start } from './harness.mjs';
let pass = 0, fail = 0;
const ok = (c, text, info = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FEHLER ') + text + (info !== '' ? '  → ' + info : '')) };
const wait = (p, ms) => p.waitForTimeout(ms);
const boot = async o => { const h = await start(o); await h.login(); await wait(h.page, o && o.delay ? o.delay + 1900 : 1900); await h.tidy(); return h };

{ console.log('Rechner');
  const h = await boot(), p = h.page;
  // Seitenwechsel springt sofort nach oben
  await h.go('analyse', 1200); await p.evaluate(() => window.scrollTo({ top: 99999, behavior: 'instant' })); await wait(p, 150);
  await p.evaluate(() => { location.hash = '#/rechnungen' }); await wait(p, 30);
  ok(await p.evaluate(() => scrollY) === 0, 'Seitenwechsel: sofort oben', 'scrollY ' + await p.evaluate(() => scrollY));
  // Dialog blendet ein und aus
  await h.go('kalender');
  const d = await p.evaluate(async () => {
    const w = document.getElementById('eventWrap'), s = w.querySelector('.sheet'), cs = getComputedStyle, z = ms => new Promise(r => setTimeout(r, ms)), o = { ev: [] };
    w.addEventListener('transitionrun', e => { if (e.target === w || e.target === s) o.ev.push((w.classList.contains('show') ? 'auf:' : 'zu:') + e.propertyName) });
    w.classList.add('show'); o.open0 = +cs(w).opacity; await z(700); o.openEnd = +cs(w).opacity; o.sheetEnd = cs(s).transform;
    w.classList.remove('show'); o.dispNow = cs(w).display; o.pe = cs(w).pointerEvents; await z(700); o.endDisp = cs(w).display; return o;
  });
  ok(d.open0 < 1 && d.ev.includes('auf:opacity') && d.ev.includes('auf:transform'), 'Dialog blendet ein, Blatt gleitet');
  ok(d.openEnd === 1 && (d.sheetEnd === 'none' || d.sheetEnd === 'matrix(1, 0, 0, 1, 0, 0)'), 'Dialog steht danach ruhig');
  ok(d.dispNow === 'flex' && d.ev.includes('zu:opacity'), 'Dialog blendet aus statt zu springen', 'direkt nach Schließen display ' + d.dispNow);
  ok(d.pe === 'none', 'Beim Ausblenden nicht mehr klickbar'); ok(d.endDisp === 'none', 'Danach wirklich weg');
  const yn = await p.evaluate(async () => { const pr = askYesNo('Test?', 'Ja', 'Nein'); await new Promise(r => setTimeout(r, 300)); document.getElementById('cfNo').click(); return await pr });
  ok(yn === false, 'askYesNo löst weiter richtig auf');
  // Aufgabe abhaken: Haken, Zeile klappt zu, erst dann wird neu gezeichnet
  await h.go('aufgaben');
  const n0 = await p.evaluate(() => {
    window.__seq = [];
    new MutationObserver(ms => ms.forEach(m => { if (m.type === 'childList') { if (m.target.id === 'taskGroups') window.__seq.push('neu') } else { const c = m.target.classList; if (c.contains('is-out')) window.__seq.push('zu'); else if (c.contains('is-doing')) window.__seq.push('haken') } }))
      .observe(document.getElementById('taskGroups'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return document.querySelectorAll('#taskGroups .task').length;
  });
  await p.locator('#taskGroups .task .chk').first().click(); await wait(p, 1000);
  const a = await p.evaluate(() => ({ seq: [...new Set(window.__seq)].join(' → '), n: document.querySelectorAll('#taskGroups .task').length, done: TASKS.filter(t => t.done).length, rest: document.querySelectorAll('.is-doing,.is-out').length }));
  ok(a.seq.startsWith('haken → zu → neu'), 'Abhaken: Haken, Zeile klappt zu, dann neu gezeichnet', a.seq);
  ok(a.n === n0 - 1 && a.done === 1 && a.rest === 0, 'Abhaken: Aufgabe erledigt, nichts bleibt hängen');
  await p.evaluate(() => document.getElementById('tDone').click()); await wait(p, 200);
  await p.locator('#taskGroups .task.done .chk').first().click(); await wait(p, 150);
  ok(await p.evaluate(() => TASKS.filter(t => t.done).length) === 0, 'Haken wieder raus wirkt sofort');
  // Kalender blättern
  await h.go('kalender'); await p.click('#calMode [data-cm="month"]'); await wait(p, 50);
  await p.click('#calNext'); await wait(p, 30); ok(await p.evaluate(() => document.getElementById('month').classList.contains('m-next')), 'Kalender: Weiter schiebt von rechts');
  await p.click('#calPrev'); await wait(p, 30); ok(await p.evaluate(() => document.getElementById('month').classList.contains('m-prev')), 'Kalender: Zurück schiebt von links');
  await p.click('#calMode [data-cm="list"]'); await wait(p, 30); ok(await p.evaluate(() => document.getElementById('calList').classList.contains('m-fade')), 'Kalender: Ansicht wechseln blendet');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Kein Querscrollen durch die Bewegung');
  // Chat: nur die neue Nachricht bewegt sich
  const c = await p.evaluate(() => { location.hash = '#/agent'; AG_CHAT.push({ role: 'user', text: 'Was steht heute an?', who: 'LP' }); renderAgent(); const l = document.querySelector('.ag-log'), one = l.lastElementChild.classList.contains('m-in'); renderAgent(); return { one, two: l.lastElementChild.classList.contains('m-in') } });
  ok(c.one && !c.two, 'Chat: neue Nachricht kommt bewegt, erneutes Zeichnen nicht');
  // Menü
  await h.go('aufgaben'); await p.locator('#taskGroups .task').first().hover(); await p.locator('#taskGroups .task .tmv').first().click(); await wait(p, 60);
  ok(await p.evaluate(() => { const m = document.querySelector('.pop-menu'); return !!m && getComputedStyle(m).animationName === 'mPop' }), 'Menü poppt weich auf'); await p.keyboard.press('Escape');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}
{ console.log('Analyse mit 700 ms Netz-Verzögerung');
  const h = await boot({ delay: 700 }), p = h.page; await h.go('heute');
  await p.evaluate(() => { location.hash = '#/analyse' }); await wait(p, 3200);
  const b = await p.evaluate(() => {
    const bars = () => [...document.querySelectorAll('#invAna .chart-svg .bar-g rect')], tall = () => Math.round(Math.max(...bars().map(r => r.getBoundingClientRect().height))), o = { vorher: tall() };
    renderAna(); o.nachher = tall(); ANA.mode = 'monat'; renderAna(); o.zeitraum = bars().some(r => r.style.animation !== 'none' && !r.style.animationDelay); ANA.mode = 'jahr'; renderAna(); return o;
  });
  ok(b.vorher > 50 && b.nachher === b.vorher, 'Analyse: Neuzeichnen lässt die Balken stehen', `vorher ${b.vorher}px, direkt nach erneutem Zeichnen ${b.nachher}px`);
  ok(b.zeitraum, 'Analyse: anderer Zeitraum lässt sie wieder wachsen');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}
{ console.log('Laden mit 2,5 s Netz-Verzögerung');
  const h = await start({ delay: 2500 }), p = h.page; await h.login(); await wait(p, 400); await h.tidy();
  await h.go('aufgaben', 300); ok(await p.evaluate(() => !!document.querySelector('#taskGroups .skel')), 'Aufgaben: Platzhalter statt Text');
  await h.go('kunden', 300); ok(await p.evaluate(() => !!document.querySelector('#kGrid .skel.cards')), 'Kundenkartei: Platzhalter-Karten');
  await h.go('aufgaben', 100); await p.waitForSelector('#taskGroups .task', { timeout: 15000 });
  ok(await p.evaluate(() => !document.querySelector('#taskGroups .skel') && document.getElementById('taskGroups').classList.contains('m-in')), 'Aufgaben: Inhalt blendet nach dem Laden ein');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}
{ console.log('Handy 390 × 844');
  const h = await boot({ mobile: true }), p = h.page; await h.go('kalender');
  const d = await p.evaluate(async () => {
    const w = document.getElementById('eventWrap'), s = w.querySelector('.sheet'), z = ms => new Promise(r => setTimeout(r, ms)), top = () => Math.round(s.getBoundingClientRect().top), o = {};
    w.classList.add('show'); await z(60); o.t60 = top(); await z(600); o.tEnd = top(); w.classList.remove('show'); await z(90); o.c90 = top(); o.disp = getComputedStyle(w).display; await z(400); o.end = getComputedStyle(w).display; return o;
  });
  ok(d.t60 > d.tEnd, 'Blatt fährt von unten rein', `${d.t60}px → ${d.tEnd}px`); ok(d.disp === 'flex' && d.c90 > d.tEnd, 'Blatt fährt nach unten raus', `90 ms nach Schließen bei ${d.c90}px`); ok(d.end === 'none', 'Danach weg');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Kein Querscrollen');
  ok(await p.evaluate(() => [...document.querySelectorAll('.tabbar a,.tabbar button')].every(b => b.getBoundingClientRect().height >= 44)), 'Tab-Leiste: Tippflächen mindestens 44 px');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}
{ console.log('Systemeinstellung „Weniger Bewegung“');
  const h = await boot({ reduced: true }), p = h.page; await h.go('aufgaben');
  const n0 = await p.evaluate(() => document.querySelectorAll('#taskGroups .task').length); await p.locator('#taskGroups .task .chk').first().click(); await wait(p, 150);
  ok(await p.evaluate(() => document.querySelectorAll('#taskGroups .task').length) === n0 - 1, 'Abhaken ohne Wartezeit');
  ok(await p.evaluate(() => { const w = document.getElementById('eventWrap'); w.classList.add('show'); return parseFloat(getComputedStyle(w).transitionDuration) < 0.001 }), 'Dialoge ohne Bewegung');
  ok(h.errs.length === 0, 'Keine Skriptfehler', h.errs.slice(0, 3).join(' | ')); await h.close();
}
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0);
