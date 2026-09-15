/* End-to-end test for Barload. Runs the real page in headless Chromium.
   Usage: node test/e2e.cjs            (needs the playwright package and a Chromium build)
   Set SHOTS=dir to also write screenshots into that directory. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PREFIX = "/ido-is-cool/";           /* mimic the GitHub Pages sub-path */
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".png":"image/png",
                ".webmanifest":"application/manifest+json", ".json":"application/json" };

let passed = 0, failed = 0;
function check(name, ok, extra){
  if (ok){ passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function eq(name, got, want){ check(name, JSON.stringify(got) === JSON.stringify(want), {got, want}); }

function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (!p.startsWith(PREFIX)){ rsp.writeHead(404); rsp.end(); return; }
      p = p.slice(PREFIX.length) || "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, {"content-type": TYPES[path.extname(f)] || "application/octet-stream"});
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}${PREFIX}`;
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, {recursive:true});
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({viewport:{width:390, height:844}, deviceScaleFactor:2,
      isMobile:true, hasTouch:true, acceptDownloads:true, ...opts});
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    page.on("dialog", d => d.accept());
    return page;
  };
  const S = page => page.evaluate(() => JSON.parse(localStorage.getItem("barload.v2")));
  const shot = (page, name) => shots ? page.screenshot({path: path.join(shots, name + ".png"), fullPage:false}) : null;
  const tapTab = (page, t) => page.click(`nav button[data-tab="${t}"]`);
  const logSets = async (page, exIndex, reps) => {
    /* open the exercise, then tap each set and pick the rep count from the pad */
    if (!(await page.locator(".ex").nth(exIndex).locator(".body").count()))
      await page.click(`[data-open="${exIndex}"]`);
    for (let si = 0; si < reps.length; si++){
      const padOpen = await page.locator(".pad.on").count();
      const onThisSet = padOpen && (await page.textContent("#padTitle")).endsWith(`set ${si + 1}`);
      if (reps[si] === null){ if (padOpen) await page.click("#padClose"); continue; }
      if (!onThisSet){
        if (padOpen) await page.click("#padClose");
        await page.click(`[data-set="${exIndex}:${si}"]`);
      }
      await page.click(`#padKeys button:text-is("${reps[si]}")`);
    }
    if (await page.locator(".pad.on").count()) await page.click("#padClose");
  };

  console.log("\nPage load and pure functions");
  let page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  eq("title", await page.title(), "Barload");
  eq("seven week cells", await page.locator(".week button").count(), 7);
  check("sub shows week counter", /Week \d+ of 12/.test(await page.textContent("#hSub")), await page.textContent("#hSub"));
  const dowNow = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const expectToday = {0:"Lower A", 1:"Upper A", 3:"Lower B", 5:"Upper B"}[dowNow];
  const card = await page.textContent(".card h2");
  check("today card matches weekday", expectToday ? card === `Today is ${expectToday}` : card === "Rest day", card);
  eq("plate 105", await page.evaluate(() => plateBreak(105).plates.map(p => p[0])), [25, 15, 2.5]);
  eq("plate 62.5", await page.evaluate(() => plateBreak(62.5).plates.map(p => p[0])), [20, 1.25]);
  eq("plate 20 is an empty bar", await page.evaluate(() => plateBreak(20).plates.length), 0);
  eq("plate 10 is lighter than the bar", await page.evaluate(() => plateBreak(10)), null);
  eq("plate 61 leaves a remainder", await page.evaluate(() => plateBreak(61).left), 0.5);
  eq("default set counts", await page.evaluate(() => S.prog.order.map(id => setsOf(S.prog.sessions[id]))), [12, 14, 13, 16]);
  eq("default schedule is Mon Tue Thu Sat", await page.evaluate(() => S.prog.order.map(id => S.prog.sessions[id].day)), [0, 1, 3, 5]);
  eq("Saturday cell holds Upper B", await page.locator(".week button").nth(5).locator(".s").textContent(), "Up B");
  eq("Friday is now a rest day", await page.locator(".week button").nth(4).locator(".s").textContent(), "—");
  eq("kg formatting", await page.evaluate(() => [kg(62.5), kg(60), kg(32.5), kg(null)]), ["62.5", "60", "32.5", "—"]);
  eq("a fresh load writes the storage key at once",
     await page.evaluate(() => JSON.parse(localStorage.getItem("barload.v2")).prog.order.length), 4);
  eq("auto backup is on by default", await page.evaluate(() => S.settings.autosave), true);
  eq("reps reach storage as they are tapped, not on finish", await page.evaluate(() => {
    startSession("upperA");
    S.live.log[0].reps[0] = 7; save();
    const written = JSON.parse(localStorage.getItem("barload.v2")).live.log[0].reps[0];
    S.live = null; save(); render();
    return written;
  }), 7);
  await page.evaluate(() => { S.settings.autosave = false; save(); });   /* quieter run; re-tested below */
  await shot(page, "01-train");

  console.log("\nProgression rule");
  await page.click('[data-start="upperA"]');
  eq("live session header", await page.textContent("#hTitle"), "Upper A");
  eq("bench shows plates", await page.textContent(".plates .cap"), "per side1×20");
  await logSets(page, 0, [8, 8, 8]);
  eq("note announces next weight", await page.textContent(".note"), "Next time: 62.5 kg");
  await shot(page, "02-live");
  await logSets(page, 2, [10, 10]);           /* low rows: shared */
  await logSets(page, 4, [12, 12]);           /* tricep pushdowns A: separate from B */
  await logSets(page, 1, [10, 10, 9]);        /* pulldowns: one set short of the top */
  await page.click("#fin");
  let st = await S(page);
  eq("bench went up", st.weights.bench, 62.5);
  eq("low rows went up", st.weights.lowrow, 72.5);
  eq("pushdowns A went up", st.weights.tripushA, 27.5);
  eq("pushdowns B untouched", st.weights.tripushB, 25);
  eq("pulldowns held", st.weights.pulldown, 60);
  eq("history has one session", st.history.length, 1);
  eq("history keeps names", st.history[0].entries[0].name, "Bench press");
  eq("unlogged exercises are not stored", st.history[0].entries.length, 4);
  check("today cell shows done", (await page.getAttribute(".week button.today .dot", "class")).includes("done"));

  await page.click('[data-start="upperB"]');
  const lowB = page.locator(".ex", {hasText:"Low rows"});
  eq("shared weight visible in Upper B", await lowB.locator(".ex-kg").textContent(), "72.5kg");
  eq("Upper B low rows has 3 sets", await lowB.locator(".ex-name span").textContent(), "3 sets, 8–10 reps");
  await page.click("#abandon");
  eq("discard clears live", (await S(page)).live, null);

  await page.click('[data-start="upperA"]');
  await logSets(page, 0, [8, 8, null]);       /* incomplete */
  await page.click("#fin");
  eq("incomplete bench does not advance", (await S(page)).weights.bench, 62.5);
  await page.click('[data-start="upperA"]');
  await logSets(page, 0, [6, 6, 6]);          /* bottom of range */
  await page.click("#fin");
  eq("bottom of range does not advance", (await S(page)).weights.bench, 62.5);
  await page.click('[data-start="upperA"]');   /* first exercise opens by itself */
  await page.click('[data-w="0:1"]');
  eq("plus override bumps live weight", await page.textContent(".hero .kg"), "65");
  eq("override is written to weights", (await S(page)).weights.bench, 65);
  await page.click("#abandon");

  console.log("\nProgress tab");
  await tapTab(page, "progress");
  eq("progress groups by session", await page.locator(".grp").allTextContents(), ["Lower A", "Upper A", "Lower B", "Upper B", "All sessions"]);
  const benchRow = page.locator('[data-px="bench"]');
  eq("bench delta", await benchRow.locator(".dlt").textContent(), "+5");
  await benchRow.click();
  eq("bench detail lists three sessions", await page.locator(".detail .drow").count(), 3);
  check("shared tag on low rows", (await page.locator('[data-px="lowrow"] em').textContent()).includes("Upper B"));
  eq("rep-range tag on repeated names", await page.locator('[data-px="tripushA"] em').textContent(), "10–12 reps");
  eq("three history rows", await page.locator("[data-ph]").count(), 3);
  await page.click('[data-ph="2"]');
  eq("history detail shows sets", await page.locator('[data-ph="2"] + .detail .drow').nth(1).locator("span").last().textContent(), "10 / 10 / 9");
  await shot(page, "03-progress");
  await page.click('[data-delh="2"]');
  eq("history row deleted", (await S(page)).history.length, 2);

  console.log("\nStall detection");
  await page.evaluate(() => {
    const mk = date => ({date, id:"lowerA", name:"Lower A", entries:[{k:"squat", name:"Squats", weight:105, reps:[6, 6, 5]}]});
    S.history.unshift(mk("2026-09-07"), mk("2026-09-14"), mk("2026-09-21")); save(); render();
  });
  await page.click('[data-px="squat"]');
  check("stall note appears", (await page.locator(".detail .hint").textContent()).includes("95 kg"));
  await page.evaluate(() => { S.history.splice(0, 3); save(); render(); });   /* squat detail stays open */
  eq("no stall note without history", await page.locator(".detail .hint").textContent(), "Not logged yet.");

  console.log("\nPlanner");
  await tapTab(page, "plan");
  check("plan sub", /4 sessions a week, 55 working sets/.test(await page.textContent("#hSub")), await page.textContent("#hSub"));
  const upperB = page.locator(".sess").nth(3);
  await upperB.locator("[data-add]").click();
  await page.fill('[data-f="name"]', "Overhead extensions");
  await page.fill('[data-f="lo"]', "10");
  await page.fill('[data-f="hi"]', "12");
  await page.fill('[data-f="inc"]', "2.5");
  await page.fill('[data-f="w"]', "20");
  await page.click(".edit [data-sets='1']");
  await page.click(".edit [data-save]");
  st = await S(page);
  const added = st.prog.sessions.upperB.plan[st.prog.sessions.upperB.plan.length - 1];
  const nid = added[0];
  eq("new exercise appended with 3 sets", [nid.startsWith("overhead"), added[1]], [true, 3]);
  eq("new exercise definition", st.prog.ex[nid], {name:"Overhead extensions", lo:10, hi:12, inc:2.5, start:20, kind:"machine"});
  eq("new exercise weight", st.weights[nid], 20);
  check("plan sub counts the new sets", /58 working sets/.test(await page.textContent("#hSub")));

  await upperB.locator('[data-edit="upperB:7"]').click();
  await page.click(".edit [data-move='-1']");
  st = await S(page);
  eq("moved up one place", st.prog.sessions.upperB.plan[6][0], nid);
  await page.fill('[data-f="w"]', "22.5");
  await page.fill('[data-f="hi"]', "15");
  await page.click(".edit [data-save]");
  st = await S(page);
  eq("edit updates weight", st.weights[nid], 22.5);
  eq("edit before any history also moves the baseline", st.prog.ex[nid].start, 22.5);
  eq("edit updates rep range", st.prog.ex[nid].hi, 15);
  await shot(page, "04-plan");

  await upperB.locator('[data-edit="upperB:6"]').click();
  await page.fill('[data-f="lo"]', "20");
  await page.click(".edit [data-save]");
  eq("invalid rep range is rejected", (await S(page)).prog.ex[nid].lo, 10);
  await page.click(".edit [data-remove]");
  st = await S(page);
  eq("removed from session", st.prog.sessions.upperB.plan.length, 7);
  check("definition kept for re-use", !!st.prog.ex[nid]);

  /* share an existing exercise: bench into Lower B */
  const lowerB = page.locator(".sess").nth(2);
  await lowerB.locator("[data-add]").click();
  await page.selectOption('[data-f="src"]', "bench");
  check("new-only fields hidden", await page.locator('[data-newonly]').first().isHidden());
  await page.click(".edit [data-save]");
  st = await S(page);
  eq("bench shared into Lower B", st.prog.sessions.lowerB.plan[st.prog.sessions.lowerB.plan.length - 1], ["bench", 2]);
  check("shared tag shown", (await lowerB.locator(".pl").last().textContent()).includes("shared"));

  /* move Upper B to Saturday; Lower A rename; delete and add session */
  await upperB.locator('[data-day="upperB:2"]').click();
  st = await S(page);
  eq("Upper B moved off Saturday to Wednesday", st.prog.sessions.upperB.day, 2);
  await upperB.locator('[data-day="upperB:0"]').click();
  st = await S(page);
  eq("taking Monday unschedules Lower A", [st.prog.sessions.upperB.day, st.prog.sessions.lowerA.day], [0, null]);
  await page.fill('[data-rename="lowerA"]', "Legs 1");
  await page.press('[data-rename="lowerA"]', "Enter");
  eq("session renamed", (await S(page)).prog.sessions.lowerA.name, "Legs 1");
  await page.click("[data-addsess]");
  st = await S(page);
  eq("session added", st.prog.order.length, 5);
  const newId = st.prog.order[4];
  await page.click(`[data-delsess="${newId}"]`);
  eq("session deleted", (await S(page)).prog.order.length, 4);
  await tapTab(page, "train");
  check("week strip reflects the move", (await page.locator(".week button").nth(0).textContent()).includes("Up B"));
  await page.locator(".week button").nth(0).click();
  eq("week cell starts its session", (await S(page)).live.id, "upperB");
  await page.click("#abandon");
  await tapTab(page, "plan");
  await page.click("[data-resetprog]");
  st = await S(page);
  eq("reset restores default sessions", [st.prog.sessions.lowerA.name, st.prog.sessions.upperB.day, st.prog.order.length], ["Lower A", 5, 4]);
  eq("reset keeps progressed weights", st.weights.bench, 65);

  console.log("\nExport and restore");
  await tapTab(page, "more");
  await shot(page, "05-more");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#json")]);
  const tmp = path.join(os.tmpdir(), "barload-test-backup.json");
  await download.saveAs(tmp);
  const backup = JSON.parse(fs.readFileSync(tmp, "utf8"));
  eq("backup is v2", backup.v, 2);
  eq("backup carries history", backup.history.length, 2);
  check("backup filename is dated", /^barload-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
  eq("saving a backup records it", await page.evaluate(() => [sinceBackup(), !!S.settings.lastBackupAt]), [0, true]);
  check("the card names the storage key", (await page.textContent(".card")).includes("barload.v2"));
  check("the card reports a last backup", (await page.textContent(".card")).includes("Last backup file:"));
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#csv")]);
  const csvTmp = path.join(os.tmpdir(), "barload-test.csv");
  await csv.saveAs(csvTmp);
  const lines = fs.readFileSync(csvTmp, "utf8").split("\n");
  eq("csv header", lines[0], "date,session,exercise,weight_kg,set1,set2,set3,set4,set5,set6");
  check("csv has the incomplete bench row", lines.some(l => /Upper A,Bench press,62.5,8,8,,,,/.test(l)), lines[1]);
  await page.uncheck("#auto");
  eq("autosave toggle turns off", (await S(page)).settings.autosave, false);
  await page.check("#auto");
  eq("autosave toggle turns back on", (await S(page)).settings.autosave, true);
  await page.click("#wipe");
  st = await S(page);
  eq("wipe clears history", st.history.length, 0);
  eq("wipe resets bench", st.weights.bench, 60);
  await tapTab(page, "more");
  await page.setInputFiles("#file", tmp);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("barload.v2")).history.length === 2);
  st = await S(page);
  eq("restore brings history back", st.history.length, 2);
  eq("restore brings weights back", st.weights.bench, 65);
  await tapTab(page, "more");
  await page.setInputFiles("#file", {name:"junk.json", mimeType:"application/json", buffer:Buffer.from('{"nope":1}')});
  await page.waitForTimeout(200);
  eq("bad file is rejected and state kept", (await S(page)).weights.bench, 65);

  console.log("\nAuto backup on finish");
  await tapTab(page, "more");
  await page.check("#auto");                  /* wipe and restore put it back to off */
  await tapTab(page, "train");
  await page.click('[data-start="lowerA"]');
  await logSets(page, 0, [8, 8, 8]);
  const [auto] = await Promise.all([page.waitForEvent("download"), page.click("#fin")]);
  check("dated per-session backup", /^barload-\d{4}-\d{2}-\d{2}-lower-a\.json$/.test(auto.suggestedFilename()), auto.suggestedFilename());
  eq("squat went up", (await S(page)).weights.squat, 110);
  await page.close();

  console.log("\nBackup prompts and blocked storage");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => {
    S.settings.autosave = false;
    S.history = [1, 2, 3].map(n => ({date:`2026-09-0${n}`, id:"lowerA", name:"Lower A",
      entries:[{k:"squat", name:"Squats", weight:100, reps:[6, 6, 6]}]}));
    save(); render();
  });
  eq("no prompt after three sessions", await page.locator(".card.nag").count(), 0);
  await page.evaluate(() => {
    S.history.push({date:"2026-09-04", id:"lowerA", name:"Lower A",
      entries:[{k:"squat", name:"Squats", weight:100, reps:[6, 6, 6]}]});
    save(); render();
  });
  eq("prompt after four", await page.textContent(".card.nag h2"), "Time for a backup");
  const [nagDl] = await Promise.all([page.waitForEvent("download"), page.click("#nagbk")]);
  check("prompt saves a backup file", /^barload-backup-\d{4}-\d{2}-\d{2}\.json$/.test(nagDl.suggestedFilename()), nagDl.suggestedFilename());
  eq("prompt clears once backed up", await page.locator(".card.nag").count(), 0);
  await tapTab(page, "more");
  const [csvOnly] = await Promise.all([page.waitForEvent("download"), page.click("#csv")]);
  await csvOnly.path();
  eq("a CSV export does not count as a backup", await page.evaluate(() => {
    S.history.push({date:"2026-09-05", id:"lowerA", name:"Lower A", entries:[]});
    return sinceBackup();
  }), 1);
  await page.close();

  page = await newPage();
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "setItem", {value(){ throw new Error("blocked"); }});
  });
  await page.goto(base, {waitUntil:"networkidle"});
  eq("blocked storage is called out", await page.textContent(".card.alert h2"), "Nothing is being saved");
  await tapTab(page, "more");
  check("the More card warns too", (await page.textContent(".card.alert")).includes("refusing to store"));
  await page.close();

  console.log("\nMigration from v1");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("barload.v1", JSON.stringify({
      weights:{bench:65, lowrow:75}, live:null,
      history:[{date:"2026-09-08", id:"upperA", entries:[{k:"bench", weight:62.5, reps:[8, 8, 8]}]}]
    }));
  });
  await page.reload({waitUntil:"networkidle"});
  st = await S(page);
  eq("v1 weights carried over", [st.weights.bench, st.weights.lowrow, st.weights.squat], [65, 75, 105]);
  eq("v1 history carried over with names", [st.history.length, st.history[0].entries[0].name, st.history[0].name], [1, "Bench press", "Upper A"]);
  eq("v1 gets the default programme", st.prog.order, ["lowerA", "upperA", "lowerB", "upperB"]);
  check("v2 key written", await page.evaluate(() => !!localStorage.getItem("barload.v2")));
  await page.close();

  console.log("\nTab bar sits on the bottom edge");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  const geom = () => page.evaluate(() => {
    const n = document.querySelector("nav").getBoundingClientRect();
    const last = [...document.querySelectorAll("main > *")].pop().getBoundingClientRect();
    return {navBottom:Math.round(n.bottom), navTop:Math.round(n.top), lastBottom:Math.round(last.bottom),
            bodyBottom:Math.round(document.body.getBoundingClientRect().bottom),
            vh:window.innerHeight, docH:Math.round(document.documentElement.scrollHeight),
            scrollable:document.documentElement.scrollHeight > window.innerHeight};
  });
  /* the Train tab is the short page that floated the bar on iPhone */
  let g = await geom();
  check("Train tab is the short page", !g.scrollable, g);
  eq("bar reaches the bottom on a short page", g.navBottom, g.vh);
  eq("the bar ends where the body ends, not where the viewport happens to", g.navBottom, g.bodyBottom);
  eq("the body fills the viewport, so nothing shows under the bar", g.docH >= g.vh, true);
  eq("no page background below the bar", await page.evaluate(() => {
    const n = document.querySelector("nav").getBoundingClientRect();
    return document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1) === null
      || n.bottom >= window.innerHeight;
  }), true);
  /* and on a long, scrolling page, at the top and at the very bottom */
  await tapTab(page, "plan");
  g = await geom();
  check("Plan tab is the long page", g.scrollable, g);
  eq("bar reaches the bottom on a long page", g.navBottom, g.vh);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(120);
  g = await geom();
  eq("bar stays on the bottom once scrolled down", g.navBottom, g.vh);
  eq("still flush with the end of the body", g.navBottom, g.bodyBottom);
  check("the last card clears the bar instead of hiding behind it", g.lastBottom <= g.navTop + 1,
        {lastBottom:g.lastBottom, navTop:g.navTop});
  await page.close();

  console.log("\nDark mode and desktop width");
  page = await newPage({colorScheme:"dark"});
  await page.goto(base, {waitUntil:"networkidle"});
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  eq("dark ground applied", bg, "rgb(18, 22, 26)");
  await shot(page, "06-dark");
  await page.click('[data-start="lowerA"]');
  await shot(page, "07-dark-live");
  await page.close();
  page = await newPage({viewport:{width:1200, height:800}, isMobile:false, hasTouch:false});
  await page.goto(base, {waitUntil:"networkidle"});
  const w = await page.evaluate(() => document.querySelector("main").getBoundingClientRect().width);
  check("content column capped on desktop", w <= 640, w);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("no horizontal overflow", !overflow);
  await page.close();

  console.log("\nStatic assets under the Pages sub-path");
  page = await newPage();
  const codes = {};
  for (const f of ["sw.js", "manifest.webmanifest", "icon-180.png", "icon-512.png"]){
    const r = await page.goto(base + f);
    codes[f] = r.status();
  }
  eq("all assets served", codes, {"sw.js":200, "manifest.webmanifest":200, "icon-180.png":200, "icon-512.png":200});
  await page.close();

  eq("no page or console errors", errors, []);
  await browser.close();
  srv.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
