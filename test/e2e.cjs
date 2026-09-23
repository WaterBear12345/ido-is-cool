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
  const ctxOpts = (opts = {}) => ({viewport:{width:390, height:844}, deviceScaleFactor:2,
    isMobile:true, hasTouch:true, acceptDownloads:true, ...opts});
  const attach = page => {
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    page.on("dialog", d => d.accept());
    return page;
  };
  const newPage = async (opts = {}) => attach(await (await browser.newContext(ctxOpts(opts))).newPage());
  const S = page => page.evaluate(() => JSON.parse(localStorage.getItem("barload.v2")));
  const shot = (page, name) => shots ? page.screenshot({path: path.join(shots, name + ".png"), fullPage:false}) : null;
  const tapTab = (page, t) => page.click(`nav button[data-tab="${t}"]`);
  /* the rep sheet: drag the slider to n, then Log set */
  /* a rep-sheet button: the finger lands on the switch over it when haptics are on */
  const tapBtn = async (page, id) => {
    const sw = page.locator(`[data-for="${id}"]`);
    if (await sw.isVisible()) await sw.click(); else await page.click("#" + id);
  };
  const pickReps = async (page, n) => {
    await page.locator("#padRange").fill(String(n));
    await tapBtn(page, "padLog");
  };
  /* a rest ending puts the green screen over everything; tap it away */
  const dismissGo = async page => { if (await page.locator("#go:not(.hide)").count()) await page.click("#goDone"); };
  const logSets = async (page, exIndex, reps) => {
    if (!(await page.locator(".ex").nth(exIndex).locator(".body").count()))
      await page.click(`[data-open="${exIndex}"]`);
    for (let si = 0; si < reps.length; si++){
      if (reps[si] === null) continue;
      await dismissGo(page);
      await page.click(`[data-set="${exIndex}:${si}"]`);
      await pickReps(page, reps[si]);
    }
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
  eq("bench draws one 20 per side", await page.getAttribute(".plates", "data-perside"), "20");
  eq("on a 20 kg bar", await page.getAttribute(".plates", "data-bar"), "20");
  check("the drawing is mirrored, one plate each side", (await page.locator(".plates svg .pl8").count()) === 2);
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
  eq("Upper B low rows has 3 sets", await lowB.locator(".ex-name span").textContent(), "3 sets, 8–10 reps · rest 1:30");
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
  eq("progress groups by muscle", await page.locator(".grp").allTextContents(),
     ["Chest", "Back", "Legs", "Arms", "Shoulders", "Core", "All sessions"]);
  const benchRow = page.locator('[data-px="bench"]');
  eq("bench delta", await benchRow.locator(".dlt").textContent(), "+5");
  await benchRow.click();
  eq("bench detail lists three sessions", await page.locator(".detail .drow").count(), 3);
  check("shared tag on low rows", (await page.locator('[data-px="lowrow"] em').textContent()).includes("Upper B"));
  eq("rep-range tag on repeated names", await page.locator('[data-px="tripushA"] em').textContent(), "Triceps · 10–12 reps");
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
  eq("new exercise definition", st.prog.ex[nid],
     {name:"Overhead extensions", lo:10, hi:12, inc:2.5, start:20, kind:"machine", rest:90, group:"triceps", barKg:20, muscles:["triceps"]});
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
  check("no sharing note while adding a new exercise", await page.locator(".edit [data-existonly]").isHidden());
  await page.selectOption('[data-f="src"]', "bench");
  check("new-only fields hidden", await page.locator('[data-newonly]').first().isHidden());
  check("the sharing note appears once an existing exercise is picked", await page.locator(".edit [data-existonly]").isVisible());
  await page.selectOption('[data-f="src"]', "");
  check("and goes again when switching back to a new one", await page.locator(".edit [data-existonly]").isHidden());
  await page.selectOption('[data-f="src"]', "bench");
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

  console.log("\nRest timer, set count mid-workout, deleting a logged session");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => { S.settings.autosave = false; save(); });
  eq("rest defaults by exercise", await page.evaluate(() =>
    [S.prog.ex.bench.rest, S.prog.ex.squat.rest, S.prog.ex.flies.rest, S.prog.ex.crunch.rest]), [150, 180, 75, 60]);
  eq("timer hidden when idle", await page.locator("#rest").isHidden(), true);
  await page.click('[data-start="upperA"]');
  check("live sub-line shows the rest", (await page.locator(".ex-name span").first().textContent()).includes("rest 2:30"));
  await page.click('[data-set="0:0"]');
  await pickReps(page, 8);
  eq("pad closes after a set", await page.locator(".pad.on").count(), 0);
  eq("timer starts with that exercise's rest", await page.textContent("#restTime"), "2:30");
  eq("timer names the exercise", await page.textContent("#restName"), "Bench press");
  eq("timer state is stored with the session", await page.evaluate(() => S.live.rest.total), 150);
  await page.click("#restPlus");
  eq("+15", await page.textContent("#restTime"), "2:45");
  await page.click("#restMinus"); await page.click("#restMinus");
  eq("-15 twice", await page.textContent("#restTime"), "2:15");
  await page.reload({waitUntil:"networkidle"});
  check("timer survives a reload", /^2:1\d$/.test(await page.textContent("#restTime")), await page.textContent("#restTime"));
  await page.evaluate(() => { S.live.rest.end = Date.now() - 500; save(); tick(); });
  eq("shows Go when it ends", await page.textContent("#restTime"), "Go");
  eq("beep recorded as done", await page.evaluate(() => S.live.rest.done), true);
  eq("the whole screen turns green", await page.locator("#go").isVisible(), true);
  check("it says what is next", (await page.textContent("#goNext")).startsWith("Next: Bench press, set 2"),
        await page.textContent("#goNext"));
  await page.click("#goMore");
  eq("+15 on the green screen resumes the rest", await page.locator("#go").isHidden(), true);
  check("and the bar counts again", /^0:1\d$/.test(await page.textContent("#restTime")), await page.textContent("#restTime"));
  await page.evaluate(() => { S.live.rest.end = Date.now() - 500; save(); tick(); });
  await page.click("#go", {position:{x:30, y:30}});
  eq("tapping anywhere clears it", await page.locator("#go").isHidden(), true);
  eq("and clears the rest", await page.locator("#rest").isHidden(), true);
  await page.click('[data-set="0:0"]'); await pickReps(page, 8);
  await page.click("#restSkip");
  eq("skip clears a running rest", await page.locator("#rest").isHidden(), true);

  await page.click('[data-nset="0:1"]');
  eq("plus adds a fourth set", await page.locator('[data-set^="0:"]').count(), 4);
  check("sub-line follows", (await page.locator(".ex-name span").first().textContent()).startsWith("4 sets"));
  await page.click('[data-nset="0:-1"]'); await page.click('[data-nset="0:-1"]'); await page.click('[data-nset="0:-1"]');
  eq("minus stops at one set", await page.locator('[data-set^="0:"]').count(), 1);
  check("minus disabled at one", await page.locator('[data-nset="0:-1"]').isDisabled());
  eq("the logged rep survived the trims", await page.evaluate(() => S.live.log[0].reps), [8]);
  await page.click('[data-nset="0:1"]');
  await logSets(page, 0, [null, 8]);
  eq("two sets at the top count as top of range", await page.evaluate(() => hitTop(S.live.log[0])), true);
  await page.click("#fin");
  st = await S(page);
  eq("history stores the two sets actually done", st.history[0].entries[0].reps, [8, 8]);
  eq("bench raised", st.weights.bench, 62.5);
  eq("the plan still says three sets", st.prog.sessions.upperA.plan[0][1], 3);
  eq("timer cleared on finish", await page.locator("#rest").isHidden(), true);

  await page.click('[data-hist="0"]');
  eq("Recent row opens Progress on that session", await page.textContent("#hTitle"), "Progress");
  eq("with its delete button showing", await page.locator('[data-delh="0"]').count(), 1);
  await page.click('[data-delh="0"]');
  st = await S(page);
  eq("session gone", st.history.length, 0);
  eq("the raise it caused is undone", st.weights.bench, 60);
  await page.evaluate(() => {
    const mk = (date, w, reps) => ({date, id:"upperA", name:"Upper A", entries:[{k:"bench", name:"Bench press", weight:w, reps}]});
    S.history = [mk("2026-09-15", 62.5, [6, 6, 6]), mk("2026-09-08", 60, [8, 8, 8])];
    S.weights.bench = 62.5; save(); openHist = 1;
  });
  await tapTab(page, "progress");
  await page.click('[data-delh="1"]');
  st = await S(page);
  eq("older session deleted", st.history.length, 1);
  eq("weight kept because a later session lifted it", st.weights.bench, 62.5);

  await tapTab(page, "plan");
  await page.click('[data-edit="upperA:0"]');
  eq("rest select shows the current value", await page.inputValue('[data-f="rest"]'), "150");
  await page.selectOption('[data-f="rest"]', "120");
  await page.click(".edit [data-save]");
  eq("rest saved", await page.evaluate(() => S.prog.ex.bench.rest), 120);
  check("row label shows it", (await page.locator('[data-edit="upperA:0"] .nm span').textContent()).includes("2:00 rest"));
  await page.locator(".sess").nth(1).locator("[data-add]").click();
  await page.fill('[data-f="name"]', "Dips");
  await page.selectOption('[data-f="rest"]', "180");
  await page.click(".edit [data-save]");
  eq("a new exercise keeps its rest", await page.evaluate(() => Object.values(S.prog.ex).find(e => e.name === "Dips").rest), 180);

  await tapTab(page, "more");
  eq("More explains haptics", (await page.textContent(".card:has(#hap)")).includes("System Haptics"), true);
  eq("so nothing on More is covered by them", await page.evaluate(() => {
    const r = document.getElementById("json").getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).id;
  }), "json");
  await page.uncheck("#hap");
  eq("the haptics toggle persists", await page.evaluate(() => S.settings.haptics), false);
  eq("and takes the switches off the rep sheet's buttons", await page.evaluate(() =>
    [...document.querySelectorAll(".hbs")].every(i => i.hidden)), true);
  await page.check("#hap");
  await page.uncheck("#snd");
  eq("beep toggle persists", await page.evaluate(() => S.settings.sound), false);
  await tapTab(page, "train");
  await page.click('[data-start="upperA"]');
  await page.click('[data-set="0:0"]'); await pickReps(page, 8);
  eq("a new session uses the edited rest", await page.textContent("#restTime"), "2:00");
  await page.click("#abandon");
  await page.click('[data-start="lowerA"]');
  await page.evaluate(() => {
    S.live.log.forEach(x => x.reps.fill(8));
    const last = S.live.log[S.live.log.length - 1]; last.reps[last.reps.length - 1] = null;
    save(); render();
  });
  const li = await page.evaluate(() => S.live.log.length - 1);
  const si = await page.evaluate(() => S.live.log[S.live.log.length - 1].reps.length - 1);
  await page.click(`[data-open="${li}"]`);
  await page.click(`[data-set="${li}:${si}"]`); await pickReps(page, 15);
  eq("no rest after the last set of the session", await page.locator("#rest").isHidden(), true);
  await page.click("#abandon");
  await page.close();

  console.log("\nBarbell, rep slider, rep ranges, muscle groups, charts");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => { S.settings.autosave = false; save(); });
  eq("squats sit on a 25 kg bar, bench on a 20", await page.evaluate(() => [S.prog.ex.squat.barKg, S.prog.ex.bench.barKg]), [25, 20]);
  eq("plate maths honours the bar", await page.evaluate(() => [plateBreak(105, 25).plates.map(p => p[0]), plateBreak(105).plates.map(p => p[0])]),
     [[25, 15], [25, 15, 2.5]]);
  eq("cable exercises are their own kind", await page.evaluate(() => [S.prog.ex.pulldown.kind, S.prog.ex.flies.kind]), ["cable", "machine"]);
  eq("guessing a group from a name", await page.evaluate(() =>
    ["Leg raise", "Leg curl", "Overhead extensions", "Shoulder press", "Lat pulldown", "Incline press", "Zottman",
     "Leg extension", "Back extension", "Lat raise", "Russian twist", "Tricep kickback", "Glute kickback", "Face pulls", "Low rows"].map(guessGroup)),
    ["abs", "hamstrings", "triceps", "shoulders", "lats", "chest", "other",
     "quads", "lowerback", "shoulders", "obliques", "triceps", "glutes", "reardelts", "upperback"]);

  await page.click('[data-start="lowerA"]');
  eq("squat card carries a legs-tinted barbell icon", await page.locator(".ex").first().locator(".ico").getAttribute("style"), "color:var(--g-legs)");
  eq("105 on the squat bar is 25 and 15 a side", await page.getAttribute(".plates", "data-perside"), "25,15");
  eq("drawn on a 25 kg bar", await page.getAttribute(".plates", "data-bar"), "25");
  await page.click('[data-barkg="0"]');
  eq("tapping the bar switches it to 20", await page.getAttribute(".plates", "data-bar"), "20");
  eq("and the plates follow", await page.getAttribute(".plates", "data-perside"), "25,15,2.5");
  eq("the switch is saved on the exercise", await page.evaluate(() => S.prog.ex.squat.barKg), 20);
  await page.click('[data-barkg="0"]');

  await page.click('[data-set="0:0"]');
  eq("slider goes well below the range", await page.getAttribute("#padRange", "min"), "0");
  check("and well above it", +(await page.getAttribute("#padRange", "max")) >= 30);
  eq("first set starts at the bottom of the range", await page.textContent("#padNum"), "5");
  eq("a tick per rep on the ruler", await page.locator("#padTrack .rt").count(), 31);
  eq("the target range is marked", await page.locator("#padTrack .rt.z").evaluateAll(els => els.map(e => +e.dataset.v)), [5, 6, 7, 8]);
  eq("numbers every five", await page.locator("#padTrack .rt b").evaluateAll(els => els.map(e => e.textContent).filter(Boolean)),
     ["0", "5", "10", "15", "20", "25", "30"]);
  eq("the ruler opens on the guessed value", await page.evaluate(() => Math.round(document.getElementById("padTrack").scrollLeft / SPACING)), 5);
  eq("ticks up to the value are lit", await page.locator("#padTrack .rt.lit").count(), 6);
  const trackW = await page.evaluate(() => document.getElementById("padTrack").clientWidth);
  check("only part of the range is in view, so each rep is wide enough to hit", trackW / 24 < 18, trackW / 24);
  await page.locator("#padRange").fill("3");
  eq("fewer than the range is allowed", await page.textContent("#padNum"), "3");
  eq("and says how far short", await page.textContent("#padZone"), "2 short of the range");
  const ticks = await page.evaluate(async () => {
    let n = 0; navigator.vibrate = () => { n++; return true; };
    const tr = document.getElementById("padTrack");
    for (const v of [4, 5, 6]){ tr.scrollLeft = v * SPACING; tr.dispatchEvent(new Event("scroll")); }
    tr.scrollLeft = 6 * SPACING; tr.dispatchEvent(new Event("scroll"));   /* no change, no tick */
    return n;
  });
  eq("scrolling the ruler sets the reps", await page.textContent("#padNum"), "6");
  eq("with one haptic tick per rep passed", ticks, 3);
  /* iPhone path: a real switch over each button takes the tap */
  eq("−, + and Log set each carry a real switch", await page.evaluate(() =>
    ["padMinus", "padPlus", "padLog"].map(id => {
      const sw = document.querySelector(`[data-for="${id}"]`), b = document.getElementById(id).getBoundingClientRect();
      const r = sw.getBoundingClientRect();
      return sw.hasAttribute("switch") && Math.abs(r.width - b.width) < 2 && Math.abs(r.height - b.height) < 2;
    })), [true, true, true]);
  eq("a tap on + lands on its switch", await page.evaluate(() => {
    const r = document.getElementById("padPlus").getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).dataset.for;
  }), "padPlus");
  const buzz = await page.evaluate(() => { window._bz = 0; navigator.vibrate = () => { window._bz++; return true; }; });
  await tapBtn(page, "padPlus"); await tapBtn(page, "padPlus"); await tapBtn(page, "padMinus");
  eq("+ and − step one rep through the switch", await page.textContent("#padNum"), "7");
  eq("each tap buzzes once on Android, the ruler following without a second buzz", await page.evaluate(() => window._bz), 3);
  eq("the ruler follows", await page.evaluate(() => Math.round(document.getElementById("padTrack").scrollLeft / SPACING)), 7);
  await page.locator("#padRange").fill("6");
  await page.evaluate(() => { S.settings.haptics = false; save(); });
  eq("haptics can be turned off", await page.evaluate(() => {
    let n = 0; navigator.vibrate = () => { n++; return true; };
    const tr = document.getElementById("padTrack");
    tr.scrollLeft = 10 * SPACING; tr.dispatchEvent(new Event("scroll"));
    return n;
  }), 0);
  await page.evaluate(() => { S.settings.haptics = true; save(); });
  await page.locator('#padTrack .rt[data-v="7"]').click();
  await page.waitForFunction(() => document.getElementById("padNum").textContent === "7");
  eq("tapping a tick scrolls it under the pointer", await page.textContent("#padNum"), "7");
  await page.locator("#padRange").fill("6");
  eq("in range", await page.textContent("#padZone"), "In range");
  await tapBtn(page, "padLog");
  await dismissGo(page);
  await page.click('[data-set="0:1"]');
  eq("the next set starts where the last one ended", await page.textContent("#padNum"), "6");
  await page.locator("#padRange").fill("8");
  eq("top of the range", await page.textContent("#padZone"), "Top of the range");
  await page.click("#padClose");
  eq("closing without logging leaves the set empty", await page.evaluate(() => S.live.log[0].reps[1]), null);

  await page.click('[data-rr="0"]');
  await page.click('[data-rrb="0:lo:-1"]'); await page.click('[data-rrb="0:lo:-1"]');
  await page.click('[data-rrb="0:hi:1"]');
  eq("rep range edited mid-workout", await page.evaluate(() => [S.prog.ex.squat.lo, S.prog.ex.squat.hi]), [3, 9]);
  check("target line follows", (await page.textContent(".reprange")).includes("3–9"));
  await page.click('[data-rrb="0:lo:1"]'); await page.click('[data-rrb="0:lo:1"]'); await page.click('[data-rrb="0:hi:-1"]');
  await page.click('[data-rr="0"]');
  eq("and back", await page.evaluate(() => [S.prog.ex.squat.lo, S.prog.ex.squat.hi]), [5, 8]);
  await page.click('[data-open="4"]');
  await page.click('[data-rr="4"]');
  check("a shared exercise warns it changes the other session", (await page.textContent(".rredit")).includes("Shared"));
  /* every kind of equipment has a drawing */
  const vizOf = async i => { await page.evaluate(i => { S.live.open = i; save(); render(); }, i);
    return page.getAttribute(".body .viz", "data-viz"); };
  eq("lower A drawings: bar, bar, machine, machine, cable", [await vizOf(0), await vizOf(1), await vizOf(2), await vizOf(3), await vizOf(4)],
     ["bar", "bar", "stack", "stack", "cable"]);
  check("the stack says where the pin goes", (await page.textContent(".body .viz")).includes("Pin at40 kg"),
        await page.textContent(".body .viz"));
  eq("icons pair equipment with the muscle", await page.locator(".ex").nth(4).locator(".ico").getAttribute("aria-label"), "Cable, Abs");
  eq("the muscle is filled on the figure", await page.locator(".ex").nth(4).locator(".ico .fp.hot").count(), 2);
  eq("an upper-body muscle shows the upper half", await page.locator(".ex").nth(4).locator(".ico svg.fig").getAttribute("viewBox"), "8 0 44 64");
  eq("a leg muscle shows the lower half", await page.locator(".ex").nth(0).locator(".ico svg.fig").getAttribute("viewBox"), "8 52 44 69");
  eq("two glyphs in each icon", await page.locator(".ex").nth(4).locator(".ico svg").count(), 2);
  await page.click("#abandon");
  await page.click('[data-start="upperA"]');
  await vizOf(3);
  eq("dumbbells drawn as a pair", await page.locator('.body .viz[data-viz="db"] .iron').count(), 8);
  check("with the total for both", (await page.textContent(".body .viz")).includes("36 kg total"));
  await page.evaluate(() => { S.live.log[3].kind = "free"; S.prog.ex.ohp.kind = "free"; save(); render(); });
  eq("a free weight is drawn with its number", await page.textContent('.body .viz[data-viz="free"] .ironlbl'), "18");
  await page.evaluate(() => { S.prog.ex.ohp.kind = "db"; save(); });
  await page.click("#abandon");
  check("session cards show their muscle groups", (await page.locator('.pick [data-start="upperA"] .gdots i').count()) >= 3);

  /* Plan: barbell switch and bar weight on a new exercise */
  await tapTab(page, "plan");
  await page.locator(".sess").nth(0).locator("[data-add]").click();
  await page.fill('[data-f="name"]', "Front squat");
  check("muscle is guessed while typing", await page.locator('.edit input[name="group"][value="quads"]').isChecked());
  eq("the picker offers fifteen muscles, each on a full figure", await page.locator(".edit .mpick label").count(), 15);
  eq("full figures are uncropped", await page.locator('.edit .mpick label:has(input[value="calves"]) svg').getAttribute("viewBox"), "8 0 44 121");
  eq("one equipment row, barbell included", await page.locator('.edit .seg.eqs label').allTextContents(),
     ["Barbell", "Dumbbell", "Machine", "Cable", "Free wt"]);
  check("bar weight hidden until Barbell is picked", await page.locator('.edit [data-when="bar"]').isHidden());
  await page.check('.edit input[name="kind"][value="bar"]');
  check("picking Barbell shows the bar weight", await page.locator('.edit [data-when="bar"]').isVisible());
  await page.check('.edit input[name="barKg"][value="25"]');
  await page.fill('[data-f="w"]', "70");
  await page.click('.edit [data-bump="lo:-1"]');
  await page.click(".edit [data-save]");
  let st2 = await S(page);
  const fs2 = Object.values(st2.prog.ex).find(e => e.name === "Front squat");
  eq("new barbell exercise", [fs2.kind, fs2.barKg, fs2.group, fs2.lo, fs2.hi], ["bar", 25, "quads", 7, 10]);
  await page.locator(".sess").nth(1).locator("[data-add]").click();
  await page.fill('[data-f="name"]', "Zottman curl");
  await page.check('.edit input[name="kind"][value="db"]');
  check("the guess from the name is picked", await page.locator('.edit input[name="group"][value="biceps"]').isChecked());
  await page.check('.edit input[name="group"][value="shoulders"]');
  await page.fill('[data-f="name"]', "Zottman curls");
  check("muscles picked by hand are not overridden by typing", await page.locator('.edit input[name="group"][value="shoulders"]').isChecked()
        && await page.locator('.edit input[name="group"][value="biceps"]').isChecked());
  await page.click(".edit [data-save]");
  st2 = await S(page);
  const z = Object.values(st2.prog.ex).find(e => e.name === "Zottman curls");
  eq("new dumbbell exercise with two muscles, the first picked is main", [z.kind, z.group, z.muscles], ["db", "biceps", ["biceps", "shoulders"]]);
  await page.click('[data-edit="upperA:0"]');
  check("editing shows Barbell picked for bench", await page.locator('.edit input[name="kind"][value="bar"]').isChecked());
  eq("with its 20 kg bar selected", await page.locator('.edit input[name="barKg"]:checked').getAttribute("value"), "20");
  await page.check('.edit input[name="kind"][value="machine"]');
  check("and the bar weight goes away", await page.locator('.edit [data-when="bar"]').isHidden());
  await page.click(".edit [data-save]");
  eq("barbell can be switched off", await page.evaluate(() => S.prog.ex.bench.kind), "machine");
  await page.click('[data-edit="upperA:0"]');
  await page.check('.edit input[name="kind"][value="bar"]');
  await page.click(".edit [data-save]");
  eq("and back on", await page.evaluate(() => S.prog.ex.bench.kind), "bar");
  await page.locator(".sess").nth(0).locator("[data-add]").click();
  await page.fill('[data-f="name"]', "Russian twists");
  check("a twist is guessed as obliques", await page.locator('.edit input[name="group"][value="obliques"]').isChecked());
  await page.check('.edit input[name="kind"][value="free"]');
  await page.fill('[data-f="w"]', "10");
  await page.click(".edit [data-save]");
  eq("free weight is its own kind", await page.evaluate(() =>
    Object.values(S.prog.ex).filter(e => e.name === "Russian twists").map(e => [e.kind, e.group])), [["free", "obliques"]]);
  check("plan rows carry icons", (await page.locator(".pl .ico").count()) >= 20);

  /* Charts */
  await page.evaluate(() => {
    const mk = (date, w, reps) => ({date, id:"upperA", name:"Upper A",
      entries:[{k:"bench", name:"Bench press", weight:w, reps}, {k:"pulldown", name:"Lat pulldowns", weight:60, reps:[10, 10, 10]}]});
    S.history = [mk("2026-09-22", 65, [8, 8, 7]), mk("2026-09-15", 62.5, [8, 8, 8]), mk("2026-09-08", 60, [8, 8, 8])];
    save();
  });
  await tapTab(page, "progress");
  eq("three stat tiles", await page.locator(".stat").count(), 3);
  eq("the consistency grid comes first", await page.textContent('[data-chart="0"] h2'), "Consistency");
  eq("three trained days", await page.locator('[data-chart="0"] > svg rect[class^="l"]').count(), 3);
  check("no squares after today", await page.evaluate(() => {
    const c = charts[0]; return c.tips[c.tips.length - 1][1] === fmtDate(todayISO());
  }));
  eq("heavier days are darker", await page.evaluate(() =>
    ["2026-09-08", "2026-09-15", "2026-09-22"].map(d => {
      const i = charts[0].tips.findIndex(t => t[1].endsWith(fmtDate(d)));
      return document.querySelectorAll('[data-chart="0"] > svg rect')[i].getAttribute("class");
    })), ["l1", "l4", "l2"]);
  const cal = charts => page.evaluate(() => {
    const c = charts[0], i = c.tips.findIndex(t => t[1].endsWith(fmtDate("2026-09-15")));
    const r = document.querySelector('[data-chart="0"] svg').getBoundingClientRect();
    return {x: r.left + c.xs[i] * r.width / c.W, y: r.top + (c.ys[i] + c.cell / 2) * r.height / c.H};
  });
  await page.locator('[data-chart="0"]').scrollIntoViewIfNeeded();
  const pt = await cal();
  await page.mouse.move(pt.x, pt.y);
  check("tapping a day names the session and its volume", (await page.textContent('[data-chart="0"] .tip')).includes("Upper A"),
        await page.textContent('[data-chart="0"] .tip'));
  eq("a key runs from less to more", await page.locator('[data-chart="0"] .calkey svg').count(), 5);
  eq("one column per session", await page.locator('[data-chart="1"] .col').count(), 3);
  const vbox = await page.locator('[data-chart="1"] svg').boundingBox();
  await page.mouse.move(vbox.x + 50, vbox.y + vbox.height / 2);
  check("hovering a column shows its value", (await page.textContent('[data-chart="1"] .tip')).includes("kg"),
        await page.textContent('[data-chart="1"] .tip'));
  check("rows have sparklines", (await page.locator('[data-px="bench"] .spark').count()) === 1);
  await page.click('[data-px="bench"]');
  eq("detail shows a weight chart", await page.locator(".detail .chart .ln").count(), 1);
  eq("one dot per session", await page.locator(".detail .chart .dot").count(), 3);
  eq("the latest weight is labelled at the end", await page.textContent(".detail .chart .lbl"), "65");
  await page.locator(".detail .chart").scrollIntoViewIfNeeded();
  const lbox = await page.locator(".detail .chart svg").boundingBox();
  await page.mouse.move(lbox.x + lbox.width - 50, lbox.y + lbox.height / 2);
  check("tooltip carries the reps", (await page.textContent(".detail .tip")).includes("8 / 8 / 7"),
        await page.textContent(".detail .tip"));
  await page.click('[data-px="rdl"]');
  eq("a lift logged fewer than twice gets a hint instead", await page.textContent(".detail .hint"), "Not logged yet.");
  await shot(page, "30-progress-charts");
  await page.close();

  console.log("\nSeveral muscles per exercise, and readouts that stay after a tap");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => { S.settings.autosave = false; save(); });
  await tapTab(page, "plan");
  await page.click('[data-edit="upperA:0"]');
  eq("bench starts with chest as main", await page.locator(".edit .mpick label.main input").getAttribute("value"), "chest");
  await page.check('.edit input[name="group"][value="triceps"]');
  await page.check('.edit input[name="group"][value="shoulders"]');
  eq("three picked", await page.locator('.edit input[name="group"]:checked').count(), 3);
  eq("chest is still main", await page.locator(".edit .mpick label.main input").getAttribute("value"), "chest");
  await page.click(".edit [data-save]");
  eq("saved in the order picked", await page.evaluate(() => [S.prog.ex.bench.group, S.prog.ex.bench.muscles]),
     ["chest", ["chest", "triceps", "shoulders"]]);
  const bicon = page.locator('[data-edit="upperA:0"] .ico');
  eq("the icon names every muscle", await bicon.getAttribute("aria-label"), "Barbell, Chest, Triceps, Shoulders");
  eq("front and back figures when the muscles need both", await bicon.locator("svg.fig").evaluateAll(els => els.map(e => e.dataset.view)), ["front", "back"]);
  eq("chest and shoulders lit on the front, both sides", await bicon.locator('svg[data-view="front"] .fp.hot').count(), 4);
  eq("triceps lit on the back", await bicon.locator('svg[data-view="back"] .fp.hot').count(), 2);
  eq("each muscle in its own colour", await bicon.locator('.fp.hot').evaluateAll(els => [...new Set(els.map(e => e.getAttribute("style")))].sort()),
     ["color:var(--g-arms)", "color:var(--g-chest)", "color:var(--g-shoulders)"]);
  eq("the icon is still tinted by the main muscle", await bicon.getAttribute("style"), "color:var(--g-chest)");
  await page.click('[data-edit="upperA:0"]');
  await page.uncheck('.edit input[name="group"][value="chest"]');
  eq("dropping the main muscle hands main to the next", await page.locator(".edit .mpick label.main input").getAttribute("value"), "triceps");
  await page.click(".edit [data-save]");
  eq("and moves bench to arms", await page.evaluate(() => regionOf(S.prog.ex.bench.group)), "arms");
  eq("half-body crop when all muscles share a half", await page.evaluate(() => [
      figure(["chest", "shoulders"], true), figure(["quads", "calves"], true), figure(["chest", "quads"], true)]
      .map(h => h.match(/viewBox="([^"]+)"/)[1])), ["8 0 44 64", "8 52 44 69", "8 0 44 121"]);
  await tapTab(page, "progress");
  eq("progress lists every muscle", await page.locator('[data-px="bench"] em').textContent(), "Triceps · Shoulders");
  check("session cards show every region trained", (await page.locator('[data-tab="train"]').count()) === 1);

  /* readouts stay put on touch */
  await page.evaluate(() => {
    const mk = (date, w) => ({date, id:"upperA", name:"Upper A", entries:[{k:"pulldown", name:"Lat pulldowns", weight:w, reps:[10, 10, 10]}]});
    S.history = [mk("2026-09-22", 65), mk("2026-09-15", 62.5), mk("2026-09-08", 60)]; save(); render();
  });
  const cellAt = day => page.evaluate(day => {
    const c = charts[0], i = c.tips.findIndex(t => t[1].endsWith(fmtDate(day)));
    const r = document.querySelector('[data-chart="0"] svg').getBoundingClientRect();
    return {x: r.left + c.xs[i] * r.width / c.W, y: r.top + (c.ys[i] + c.cell / 2) * r.height / c.H};
  }, day);
  await page.locator('[data-chart="0"]').scrollIntoViewIfNeeded();
  let at = await cellAt("2026-09-15");
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(300);
  check("a tapped square keeps its readout after the finger lifts", await page.locator('[data-chart="0"] .tip.on').count() === 1);
  check("and it is the right day", (await page.textContent('[data-chart="0"] .tip')).includes(await page.evaluate(() => fmtDate("2026-09-15"))));
  at = await cellAt("2026-09-22");
  await page.touchscreen.tap(at.x, at.y);
  check("tapping another square moves it", (await page.textContent('[data-chart="0"] .tip')).includes(await page.evaluate(() => fmtDate("2026-09-22"))));
  eq("the tapped square is outlined", await page.locator('[data-chart="0"] > svg rect.on').count(), 1);
  const vb = await page.locator('[data-chart="1"] svg').boundingBox();
  await page.touchscreen.tap(vb.x + vb.width - 30, vb.y + vb.height / 2);
  check("tapping another chart moves the readout there", await page.locator('[data-chart="1"] .tip.on').count() === 1
        && await page.locator('[data-chart="0"] .tip.on').count() === 0);
  await page.touchscreen.tap(20, 60);
  await page.waitForTimeout(200);
  eq("a tap anywhere else clears it", await page.locator(".tip.on").count(), 0);
  await page.close();

  console.log("\nMigration adds groups and bars to an existing programme");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => {
    const o = JSON.parse(JSON.stringify(S));
    for (const k in o.prog.ex){ delete o.prog.ex[k].group; delete o.prog.ex[k].barKg;
      if (o.prog.ex[k].kind === "cable") o.prog.ex[k].kind = "machine"; }
    o.prog.ex.mine = {name:"Hanging leg raise", lo:8, hi:12, inc:0, start:0, kind:"machine", rest:60};
    o.weights.mine = 0;
    localStorage.setItem("barload.v2", JSON.stringify(o));
  });
  await page.reload({waitUntil:"networkidle"});
  eq("old data gains groups, cable and the 25 kg squat bar", await page.evaluate(() =>
    [S.prog.ex.bench.group, S.prog.ex.pulldown.kind, S.prog.ex.squat.barKg, S.prog.ex.bench.barKg, S.prog.ex.mine.group]),
    ["chest", "cable", 25, 20, "abs"]);
  await page.evaluate(() => { S.prog.ex.pulldown.kind = "machine"; save(); });
  await page.reload({waitUntil:"networkidle"});
  eq("a kind changed by hand afterwards is left alone", await page.evaluate(() => S.prog.ex.pulldown.kind), "machine");
  /* a log from before specific muscles: groups were the six regions */
  await page.evaluate(() => {
    const o = JSON.parse(JSON.stringify(S));
    delete o.settings.muscles;
    const region = {chest:"chest", lats:"back", upperback:"back", lowerback:"back", quads:"legs", adductors:"legs",
      glutes:"legs", hamstrings:"legs", calves:"legs", biceps:"arms", triceps:"arms", shoulders:"shoulders",
      reardelts:"shoulders", abs:"core", obliques:"core"};
    for (const k in o.prog.ex){ o.prog.ex[k].group = region[o.prog.ex[k].group] || o.prog.ex[k].group; delete o.prog.ex[k].muscles; }
    o.prog.ex.mine.group = "arms";           /* a custom exercise whose name says nothing */
    o.prog.ex.ohp.group = "arms";            /* a default one moved to another region by hand */
    o.prog.ex.kick = {name:"Tricep kickback", lo:10, hi:12, inc:1, start:5, kind:"db", rest:60, group:"arms", barKg:20};
    o.weights.kick = 5;
    localStorage.setItem("barload.v2", JSON.stringify(o));
  });
  await page.reload({waitUntil:"networkidle"});
  eq("old regions become specific muscles", await page.evaluate(() =>
    ["bench", "facepull", "lowrow", "pulldown", "crunch", "tripushA", "preacher", "rdl", "calfA", "hipadd"].map(k => S.prog.ex[k].group)),
    ["chest", "reardelts", "upperback", "lats", "abs", "triceps", "biceps", "hamstrings", "calves", "adductors"]);
  eq("custom ones are guessed within their region, else its main muscle", await page.evaluate(() =>
    [S.prog.ex.kick.group, S.prog.ex.mine.group, S.prog.ex.ohp.group]), ["triceps", "biceps", "biceps"]);
  eq("every exercise now has a muscle list headed by its group", await page.evaluate(() =>
    Object.values(S.prog.ex).every(e => Array.isArray(e.muscles) && e.muscles[0] === e.group)), true);
  eq("and it only happens once", await page.evaluate(() => { S.prog.ex.bench.muscles = ["triceps"]; S.prog.ex.bench.group = "triceps"; save(); return S.settings.muscles; }), 2);
  await page.reload({waitUntil:"networkidle"});
  eq("a later hand-picked muscle survives reloads", await page.evaluate(() => S.prog.ex.bench.group), "triceps");
  await page.close();

  console.log("\nPlan changes reach the workout in progress");
  page = await newPage();
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => { S.settings.autosave = false; save(); });
  const shape = () => page.evaluate(() => S.live.log.map(x => [x.k, x.reps.map(r => r ?? 0).join("")]));
  await page.click('[data-start="upperA"]');
  await logSets(page, 0, [8, 7]);              /* bench: two of three logged */
  await dismissGo(page);
  await logSets(page, 2, [9]);                 /* low rows: one of two logged */
  await dismissGo(page);
  await page.click('[data-open="3"]'); await page.click('[data-nset="3:1"]');   /* ohp +1 set, live only */
  await tapTab(page, "plan");
  eq("plan marks the running session", await page.locator(".sess").nth(1).locator(".nowtag").textContent(), "In progress");
  await page.click('[data-edit="upperA:0"]');
  await page.click(".edit [data-sets='1']");
  check("the change is announced", (await page.textContent("#toast")).includes("workout in progress is updated"));
  eq("a set added in Plan appears in the workout, logged sets kept",
     (await shape())[0], ["bench", "8700"]);
  await page.click(".edit [data-sets='-1']"); await page.click(".edit [data-sets='-1']"); await page.click(".edit [data-sets='-1']");
  eq("cutting sets in Plan never drops a logged one", (await shape())[0], ["bench", "87"]);
  eq("the plan itself says one set", await page.evaluate(() => S.prog.sessions.upperA.plan[0][1]), 1);
  eq("the live-only extra set on another exercise is untouched", (await shape())[3], ["ohp", "000"]);
  await page.click('[data-edit="upperA:0"]');
  await page.click('[data-edit="upperA:1"]');
  await page.click(".edit [data-remove]");
  check("an unlogged exercise removed in Plan leaves the workout", !(await shape()).some(([k]) => k === "pulldown"));
  await page.click('[data-edit="upperA:1"]');                 /* low rows, now second */
  await page.click(".edit [data-remove]");
  eq("a removed exercise with logged sets stays, at the end", (await shape()).pop(), ["lowrow", "90"]);
  await page.click('[data-edit="upperA:3"]');                 /* preacher curls */
  await page.click(".edit [data-move='-1']");
  eq("reordering in Plan reorders the workout", (await shape()).map(([k]) => k),
     ["bench", "ohp", "preacher", "tripushA", "lowrow"]);
  await page.click('[data-edit="upperA:2"]');
  await page.locator(".sess").nth(1).locator("[data-add]").click();
  await page.selectOption('[data-f="src"]', "facepull");
  await page.click(".edit [data-save]");
  eq("an exercise added in Plan joins the workout", (await shape())[4], ["facepull", "00"]);
  eq("at its current weight", await page.evaluate(() => S.live.log[4].weight), 15);
  const before = JSON.stringify(await shape());
  await page.locator(".sess").nth(0).locator('[data-edit="lowerA:0"]').click();
  await page.click(".edit [data-sets='1']");
  eq("editing a different session leaves the workout alone", JSON.stringify(await shape()), before);
  await page.click(".edit [data-sets='-1']");
  await tapTab(page, "train");
  eq("the Train tab shows the updated workout", await page.locator(".ex").count(), 6);
  check("with the logged bench sets intact", (await page.locator(".ex").first().textContent()).includes("2 sets"));
  await page.click("#fin");
  st = await S(page);
  eq("finishing records what was done, removed-but-logged included",
     st.history[0].entries.map(x => [x.k, x.reps.join("/")]), [["bench", "8/7"], ["lowrow", "9/"]]);
  await page.close();

  console.log("\nScreen wake lock keeps the timer audible");
  /* Real Chrome and Safari grant the screen wake lock silently on a visible page. The
     headless shell denies it unless granted over CDP, and that grant lasts only as long
     as the CDP session that made it stays attached, so the session is held open until
     this section's browser closes. */
  const wlBrowser = await chromium.launch();
  const wlCtx = await wlBrowser.newContext(ctxOpts());
  const wlCdp = await wlBrowser.newBrowserCDPSession();
  for (const id of (await wlCdp.send("Target.getBrowserContexts")).browserContextIds)
    await wlCdp.send("Browser.grantPermissions", {permissions:["wakeLockScreen"], browserContextId:id});
  page = attach(await wlCtx.newPage());
  await page.goto(base, {waitUntil:"networkidle"});
  await page.evaluate(() => { S.settings.autosave = false; save(); });
  check("wake lock is supported in this environment", await page.evaluate(() => "wakeLock" in navigator));
  eq("no lock held before any rest", await page.evaluate(() => wakeLock), null);
  await page.click('[data-start="upperA"]');
  await page.click('[data-set="0:0"]'); await pickReps(page, 8);
  await page.waitForFunction(() => wakeLock !== null);
  eq("starting a rest acquires a screen lock", await page.evaluate(() => wakeLock.type), "screen");
  await page.click("#restSkip");
  eq("skip releases it", await page.evaluate(() => wakeLock), null);
  await page.click('[data-set="0:1"]'); await pickReps(page, 8);
  await page.waitForFunction(() => wakeLock !== null);
  await page.evaluate(() => { S.live.rest.end = Date.now() - 200; save(); tick(); });
  await page.waitForTimeout(300);
  eq("the lock is released once the rest ends on its own", await page.evaluate(() => wakeLock), null);
  await dismissGo(page);
  await page.click('[data-set="0:2"]'); await pickReps(page, 8);
  await page.waitForFunction(() => wakeLock !== null);
  eq("beep vibrates the phone", await page.evaluate(() => {
    let called = null;
    navigator.vibrate = p => { called = p; return true; };
    S.live.rest.end = Date.now() - 200; save(); tick();
    return called;
  }), [200, 80, 200]);
  await page.click("#goMore");                          /* +15 after Go: running again */
  await page.waitForFunction(() => wakeLock !== null);
  eq("extending a finished rest takes the lock again", await page.evaluate(() => wakeLock.type), "screen");
  /* When the page hides, the OS releases the sentinel itself. Do that release, prove the
     listener noticed, then bring the page back and prove the lock comes back with it. */
  await page.evaluate(async () => {
    Object.defineProperty(document, "hidden", {value:true, configurable:true});
    document.dispatchEvent(new Event("visibilitychange"));
    await wakeLock.release();
  });
  await page.waitForFunction(() => wakeLock === null);
  eq("the release listener clears the reference", await page.evaluate(() => wakeLock), null);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {value:false, configurable:true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => wakeLock !== null);
  eq("coming back into view re-acquires the lock while a rest is still running", await page.evaluate(() => wakeLock.type), "screen");
  await page.evaluate(() => { delete document.hidden; });
  await page.click("#abandon");
  await wlBrowser.close();

  console.log("\nAppearance: system, light or dark");
  const bodyBg = p => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const LIGHT = "rgb(230, 232, 235)", DARK = "rgb(18, 22, 26)";
  page = await newPage({colorScheme:"light"});
  await page.goto(base, {waitUntil:"networkidle"});
  eq("System by default, following a light phone", [await page.evaluate(() => S.settings.theme), await bodyBg(page)], ["system", LIGHT]);
  await tapTab(page, "more");
  eq("three choices", await page.locator("#theme label").allTextContents(), ["System", "Light", "Dark"]);
  await page.check('#theme input[value="dark"]');
  eq("Dark turns a light phone's app dark", [await page.getAttribute("html", "data-theme"), await bodyBg(page)], ["dark", DARK]);
  eq("cards follow", await page.evaluate(() => getComputedStyle(document.querySelector(".card")).backgroundColor), "rgb(28, 33, 39)");
  eq("so do form controls", await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
  await page.reload({waitUntil:"domcontentloaded"});
  eq("the choice is applied before the app script runs, so nothing flashes", await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme")), "dark");
  await page.waitForLoadState("networkidle");
  eq("and survives a reload", await bodyBg(page), DARK);
  await page.close();
  page = await newPage({colorScheme:"dark"});
  await page.goto(base, {waitUntil:"networkidle"});
  eq("System follows a dark phone", await bodyBg(page), DARK);
  await tapTab(page, "more");
  await page.check('#theme input[value="light"]');
  eq("Light turns a dark phone's app light", [await page.getAttribute("html", "data-theme"), await bodyBg(page)], ["light", LIGHT]);
  await page.check('#theme input[value="system"]');
  eq("System hands it back to the phone", [await page.getAttribute("html", "data-theme"), await bodyBg(page)], [null, DARK]);
  eq("the theme picker covers nothing else on More", await page.evaluate(() => {
    document.getElementById("json").scrollIntoView({block:"center"});
    const r = document.getElementById("json").getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).id;
  }), "json");
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
