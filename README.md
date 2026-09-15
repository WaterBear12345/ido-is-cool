# Barload

A workout planner and training log for a 4-day Upper/Lower split, built as a static
web app for GitHub Pages. No server, no accounts, no build step. Your log is stored on
your phone and the target weight for every exercise is computed for you.

Live URL once Pages is enabled: `https://waterbear12345.github.io/ido-is-cool/`

## Files

- `index.html` — the whole app, one self-contained file
- `sw.js` — service worker, so it works offline in the gym
- `manifest.webmanifest`, `icon-180.png`, `icon-512.png` — home screen icon and name
- `.nojekyll` — tells GitHub Pages to serve the files exactly as they are
- `test/e2e.cjs` — end-to-end test, see below

## Putting it online

1. Merge this branch into `main`.
2. In the repository, go to Settings, then Pages in the sidebar.
3. Under "Build and deployment", set Source to "Deploy from a branch", branch `main`,
   folder `/ (root)`. Save.
4. Wait a minute or two, then reload the Pages settings page for your URL.

## Adding it to your home screen

Open the URL in **Safari**. This does not work in Chrome on iOS. Share button, then
"Add to Home Screen". It gets an icon and opens full screen with no browser bar. Load it
once on wifi and it works without signal after that.

## What it does

**Train.** Opens on this week. Each day shows the session scheduled for it, a green dot
when something was logged that day, blue for today and red for a missed day. Start the
session, tap an exercise, tap a set, tap a rep count. The pad moves to the next set by
itself. Barbell lifts show which plates to load per side in competition colours.
Finish and save advances every weight that earned it.

**Plan.** The programme is editable in the app. Rename sessions, move them between days,
add or remove sessions, and for each exercise change the sets, rep range, increment,
current weight and equipment type. Reorder with the arrows. "Add exercise" can either
create a new exercise or pick an existing one, which shares its weight with the other
session it is in. That is how linking works: low rows and cable crunches are shared by
default and climb twice a week. Squats, leg curls, calf raises and tricep pushdowns are
repeated on separate weights because their rep ranges differ.

**Progress.** Current weight and gain since the start for every exercise, with a
sparkline of recent sessions. Tap a row for its last six sessions. Three sessions at one
weight with no rep improvement shows a stall note with a suggested reset weight. Below
that, every logged session with its sets, and the option to delete one.

**More.** CSV export, full JSON backup, restore from a file, an optional dated backup
file after every session, the programme start date for the week counter, and a full reset.

## How the weights move

Double progression. Each exercise has a rep range. The weight holds until every working
set reaches the top of the range, then it goes up by the increment and you drop back to
the bottom of the range. A skipped session carries the weight forward unchanged. An
exercise with an unlogged set does not advance.

## Backing up

The log lives in this browser's storage on this phone only. Clearing Safari website data
erases it. Export a backup every few weeks, or turn on the dated backup after every
session in More, and keep the files in iCloud Drive. Restore reads one of those files
back. Backups from the earlier version of the app restore too.

## Changing the programme in code

The defaults are in `index.html` in the `DEFAULT_EX` and `DEFAULT_SESSIONS` blocks near
the top of the script. `lo` and `hi` are the rep range, `inc` is the weight jump,
`start` is the starting weight, `kind` is `bar`, `db` or `machine`. Days run 0 for
Monday to 6 for Sunday. Two sessions referencing the same key share a weight.
Changes there only apply to fresh installs or after "Reset programme" in Plan.

## Testing

`test/e2e.cjs` drives the real page in headless Chromium: plate maths, the progression
rule including incomplete and bottom-of-range sessions, shared versus separate weights,
the planner, migration from the old storage format, and export then restore.

```
npm install playwright
npx playwright install chromium
node test/e2e.cjs
```
