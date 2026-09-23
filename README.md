# Barload

A workout planner and training log for a 4-day Upper/Lower split, built as a static
web app for GitHub Pages. No server, no accounts, no build step. Your log is stored on
your phone and the target weight for every exercise is computed for you.

The week runs Monday Lower A, Tuesday Upper A, Thursday Lower B, Saturday Upper B.
Any of that can be changed in the Plan tab.

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

**Train.** Opens on this week, and warns you at the top if storage is blocked or a backup
is overdue. Each day shows the session scheduled for it, a green dot
when something was logged that day, blue for today and red for a missed day. Start the
session, tap an exercise, tap a set, and drag the slider to the reps you did, then Log set.
The slider runs from zero to well past the top of the range, so a set short of the
target is one drag away; it starts where your last set ended and marks the target
range on its track. Every exercise has an icon pairing its equipment with the muscle
group it trains, tinted in that group's colour. Every exercise also has a drawing of
what to load. Barbells show the loaded bar in competition plate colours with the
plates per side; tap "25 kg bar" to switch the bar between 20 and 25 kg on the spot.
Dumbbells show the pair with the weight per hand and in total. Machines show the
weight stack with the pin under the lifted plates, and cables add the pulley and
handle. Free weights show a single weight with its number on it.
"Edit" beside the target changes that exercise's rep range mid-workout.
Logging a set starts a rest timer in the tab bar for that exercise's rest time, with
−15 and +15 to adjust the one running and Skip to clear it. When it ends the whole screen turns green with the next set on it, and it
beeps and vibrates. Tap anywhere to carry on, or +15 s for more rest. While a rest is running the app asks the phone not to auto-lock from sitting
idle, because both the beep and the vibration are silenced the moment the screen goes
off; the count itself carries on regardless and is correct when you look again.
Pressing the side button still locks the phone, and there is no way for a web page to
make a locked phone buzz without a server sending it a push, which this has not got.
Vibration never fires on an iPhone in any browser, since Apple has not built the API
into iOS; the beep does. Under the sets, "− set" and "+ set" change how many sets you
do this time without touching the plan. Finish and save advances every weight that
earned it.

**Plan.** The programme is editable in the app. Rename sessions, move them between days,
add or remove sessions, and for each exercise change the sets, rep range, increment,
rest between sets, current weight, muscle group and equipment. Equipment is one row:
barbell, dumbbell, machine, cable or free weight, the last for things like Russian
twists with a plate or kettlebell. Picking barbell asks whether the bar is 20 or 25 kg. A new exercise guesses its muscle group from its
name until you pick one.

Plan changes made during a workout carry straight into it. Adding, removing or
reordering exercises, or changing a set count, updates the workout in progress, and
Plan marks that session "In progress". Nothing already logged is lost: a set count
never drops below the last logged set, and an exercise removed after you logged sets
on it stays in the workout, at the end. A "+ set" made during the workout is kept
unless that exercise's set count is changed in Plan. Reorder with the arrows. "Add exercise" can either
create a new exercise or pick an existing one, which shares its weight with the other
session it is in. That is how linking works: low rows and cable crunches are shared by
default and climb twice a week. Squats, leg curls, calf raises and tricep pushdowns are
repeated on separate weights because their rep ranges differ.

**Progress.** Sessions logged, volume this week and how many weights have gone up, then
a chart of the volume moved in each of the last twelve sessions. Below that, every
exercise grouped by muscle, with its current weight, gain since the start and a
sparkline. Tap a row for a chart of its working weight over time and its last six
sessions; tap or drag across any chart for the values. Three sessions at one
weight with no rep improvement shows a stall note with a suggested reset weight. Below
that, every logged session with its sets, and the option to delete one. Tapping a
session in the Recent list on Train lands there too. Deleting a session also undoes any
weight increase it caused, as long as nothing later has been lifted at the new weight.

**More.** Where the log is kept and when it was last backed up, CSV export, full JSON
backup, restore from a file, the dated backup after every session, the beep at the end
of a rest, the programme start date for the week counter, and a full reset.

## How the weights move

Double progression. Each exercise has a rep range. The weight holds until every working
set reaches the top of the range, then it goes up by the increment and you drop back to
the bottom of the range. A skipped session carries the weight forward unchanged. An
exercise with an unlogged set does not advance.

## Where your data goes

Every rep you tap is written immediately to `localStorage` under the key `barload.v2`,
in the browser on the device you tapped it on. Not on finishing the session, and not on
closing the app: on the tap. Nothing is transmitted anywhere, there is no account, and
the repository never sees it.

That is a deliberate consequence of being static. GitHub Pages serves files and has no
way to accept a write, so there is no server that could hold a log even in principle.
Two things follow.

It **survives** closing the app, restarting the phone, updating the app, and being in
the gym basement with no signal. A new version of the app inherits the existing log.

It **does not survive** clearing Safari website data, deleting the home screen icon,
or setting up a new phone. There is exactly one copy and it is on that device.

So the app writes a second copy you own. After every session it saves a dated JSON file,
`barload-2026-09-15-lower-a.json`, which on iPhone lands in Files and therefore in iCloud
Drive. That file is the permanent record: versioned, backed up by Apple, readable without
the app, and restorable into it. The toggle is in More if you would rather not have the
one extra tap, and in that case the app will prompt you to save a backup every four
sessions instead. The Train tab says so plainly if storage is blocked, as it is in a
private window, so a lost log is never silent.

Restore takes any of those files, or the export from the earlier version of the app.

If you ever want the log on more than one device, the honest options are a Google Apps
Script web app deployed from a sheet, which can accept writes from a static page, or a
GitHub personal access token in the browser committing to this repository. Both are real
work and both put a credential on the phone. Neither is built.

## Backing up

More, then "Save a full backup file". Keep it in iCloud Drive or Google Drive. The CSV
export is for reading in a spreadsheet and cannot be restored; the JSON file restores
everything including the programme.

## Changing the programme in code

The defaults are in `index.html` in the `DEFAULT_EX` and `DEFAULT_SESSIONS` blocks near
the top of the script. `lo` and `hi` are the rep range, `inc` is the weight jump,
`start` is the starting weight, `kind` is `bar`, `db`, `machine`, `cable` or `free`, `barKg` is
20 or 25 for a barbell, `group` is the muscle group, and `rest` is the seconds between
sets. The defaults for those last three live in `DEFAULT_BAR`, `DEFAULT_GROUP` and
`DEFAULT_REST`. Squats default to a 25 kg bar. An existing log picks up groups, cable
and the squat bar once, on first load; anything you change by hand afterwards stays. Days run 0 for
Monday to 6 for Sunday, so Upper B is day 5. Two sessions referencing the same key share a weight.
Changes there only apply to fresh installs or after "Reset programme" in Plan.

## Testing

`test/e2e.cjs` drives the real page in headless Chromium: plate maths, the progression
rule including incomplete and bottom-of-range sessions, shared versus separate weights,
the planner, migration from the old storage format, export and restore, the backup
prompt, the blocked-storage warning, the rest timer and its green screen, mid-workout
set changes, the rep slider, rep ranges edited mid-workout, the drawing for every kind
of equipment and the bar switch, muscle groups and their migration, the charts, and deleting a session with
its weight rolled back.

```
npm install playwright
npx playwright install chromium
node test/e2e.cjs
```
