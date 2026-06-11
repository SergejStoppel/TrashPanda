# TrashPanda Implementation Plan

A roadmap for evolving the Download Raccoon companion into an expressive desktop
character and a genuinely useful, fully local declutter assistant.

Guiding constraints (unchanged, non-negotiable):

- Everything runs on the local machine. No network requests, ever.
- Metadata only by default. The app does not read file contents.
- The app never deletes files. It recommends and moves into reversible piles.
- All destructive-looking actions require explicit user confirmation.

---

## 1. Goals

1. Redraw the raccoon as a warm, friendly pixel character (see art reference).
2. Build an animation system that supports many states, smooth transitions,
   facing direction, and movement across the screen.
3. Give the raccoon a richer interaction model: proactive nudges, drag-and-drop
   file handling, and ambient charm (petting, napping, reacting).
4. Expand the cleanup engine from "watch Downloads" to a safe, scored,
   whole-drive declutter advisor that surfaces old and forgotten files.

---

## 2. Current State (baseline)

- Single 48px procedural sprite, 4 frames wide, 9 state rows, scaled 3x in CSS.
- States: idle, notice, carry, sweep, buried, celebrate, sleep, think, bin.
- Moods derived from Downloads file count: tidy, curious, busy, buried, missing.
- Cursor-follow pupils and random idle tricks already exist.
- `main.js` owns files, window, and position. The renderer owns animation.
- Services: downloadScanner, fileCategorizer, fileMover, cleanupPlanner,
  trashAdvisor, historyStore, settingsStore.
- Watching is a single `fs.watch` on the Downloads folder.

---

## 3. Workstream 1: Art Direction

Target look, taken from the shared reference:

- Warm lavender-grey fur instead of the cold near-black.
- Cream chest and belly with a soft tuft.
- Tan ringed tail. The rings are the signature and must read clearly.
- Peach inner ears.
- Soft dark-brown outline (not pure black) with a lighter rim on top edges.
- Happy closed-eye face with open mouth and tongue as the celebrate/happy pose.

Implementation:

- Expand the palette in `scripts/generate-pixel-assets.js`: add rim highlight,
  a shadow ramp, cream, tan, ring-dark, peach, tongue-pink.
- Redraw the base body with rounder proportions and a visible chest tuft.
- Give the tail proper alternating rings.
- Keep generation fully procedural so assets stay reproducible via `npm run assets`.
- PNGs are build artifacts. The generator script is the source of truth.

---

## 4. Workstream 2: Animation System

Three structural upgrades:

1. **Variable frames per state.** Replace the fixed 4-frame constant with a
   per-state frame count (for example 6-8 for walk and blink, 4 for simple poses).
   The sheet width becomes `maxFrames * FRAME`. Rows that use fewer frames leave
   trailing transparent columns.
2. **Facing direction.** One walk row, mirrored with `transform: scaleX(-1)` in
   CSS so the raccoon can face left or right without doubling the sheet.
3. **Renderer state machine.** Replace the ad hoc "set state, set timer" logic in
   `companion.js` with a small machine that has per-state entry, loop, and exit,
   so transitions can ramp (idle to sleep yawns first, tidy to buried slumps)
   instead of hard-cutting.

CSS note: `steps()` requires a literal integer step count, so each state gets an
explicit animation rule with its own frame count and shift distance. Verbose but
reliable in Electron's Chromium.

New states to draw (roughly doubles the current set):

walk, peek, grab/hold, toss-to-bin, pet/happy, yawn, startled, wave, eat, shrug.

---

## 5. Workstream 3: Interaction Model

Phased by ambition. The user chose a mix of proactive nudges, direct
manipulation, and ambient charm, with appetite for full expressive character.

### 5a. Ambient charm (renderer only, no main changes)

- Pet it: click-hold triggers a lean-in happy wiggle with hearts or sparkles.
- Naps after a period of system idle, perks and waves when the user returns
  (reuse the existing cursor-activity signal).
- Random ambient loops during long idle: groom, scratch, look around, eat a crumb.
- Time-of-day greeting bubbles.

### 5b. Direct manipulation (new IPC + reuse fileMover)

- Enable HTML5 file drop on the companion window.
- Drop a file on the raccoon: it grabs and sorts that single file into its pile.
- Drop on the bin sprite: flag as a toss hunch (never deletes, per the rules).
- New single-file payload path through the existing `moveFiles` flow.

### 5c. Proactive nudges (animated window movement)

- Animate the companion window via `setPosition`, frame by frame, to let the
  raccoon walk.
- On a new download, walk toward the nearest screen edge, peek, carry a crumb home.
- When clutter crosses a threshold, walk to center, point, then slump back. Rare.
- Small idle wander radius around the home corner.

Guardrails for movement: respect multi-monitor work-area bounds, keep walks rare
and short, and add a "pin raccoon" setting for users who dislike movement.

---

## 6. Workstream 4: Declutter Rule Engine

Expand from Downloads-only to a safe, scored, whole-drive advisor. This is the
"genuinely useful" core. All detection is metadata only by default.

### 6a. Detection rules

High reclaim, high safety:

- Old installers: exe/msi/dmg/pkg named setup or installer, in Downloads,
  older than ~60 days.
- Stale large files: larger than a size threshold and unmodified for 6+ months.
- Extracted archives: a zip/rar with a sibling folder of the same name nearby,
  and old. The archive is redundant.
- Temp leftovers: tmp, part, crdownload, orphaned logs, empty files, empty folders.

Forgotten / never-used (the "discover old docs and images" goal):

- Never-opened downloads: last access never advanced past creation, and old.
- Stale screenshots: screenshot or IMG_ naming, old.
- Aged media: large videos and image dumps untouched for a long time.
- Redundant versions: copy, (1), final, final2, v3 clustered in one folder.

Duplicates:

- Cheap pass: same size plus same or similar name across locations. Metadata only.
- Strong pass: optional content hash to confirm true duplicates. This reads
  bytes, so it is opt-in and clearly labeled, since it crosses the
  no-content-reading default.

### 6b. Confidence scoring

Each hunch carries a score from signals: location, age, type, size, naming
pattern. The panel sorts "almost certainly junk" above "maybe" so the user can
skim high-confidence items fast and ignore the rest.

### 6c. Scan and index architecture

- `fs.watch` on the whole drive does not scale. Move to a periodic background
  scan that walks allowed roots and builds a cached metadata index.
- Skip exclusion zones during the walk for speed and safety.
- Re-scan on a schedule and on demand. The live watcher stays only for the
  primary Downloads folder for instant reactions.

### 6d. Two technical realities

- Last-access time is unreliable on Windows (NTFS often disables access-time
  updates). Use modified time as the primary age signal and treat access time as
  a bonus hint only.
- Whole-drive scans are expensive. Index, cache, and exclude aggressively.

---

## 7. Privacy and Safety Guardrails (apply to everything)

- Local only. No network calls, ever.
- Metadata only by default. Content reading (dedup hashing) is opt-in and disclosed.
- Recommendations only. Never auto-delete.
- Quarantine, not delete. Sorted-out files move to a reversible holding pile.
- Hard exclusion zones: Windows, Program Files, AppData program data, .git,
  node_modules, cloud-sync folders, plus a user safelist.
- Confidence score on every hunch.
- Always confirm before any move. Skip locked or in-use files gracefully.

---

## 8. Architecture Changes (file map)

- `scripts/generate-pixel-assets.js`: new palette, variable frames, new states,
  redrawn body and tail.
- `src/companion.css`: new sheet dimensions, per-state frame rules, facing flip,
  pet and movement visuals.
- `src/companion.js`: state machine, ambient loops, pet handler, file-drop
  handling, walk choreography hooks.
- `src/main.js`: window-mover utility, single-file sort IPC, whole-drive scan
  scheduling, exclusion-zone enforcement.
- `src/preload.js`: new IPC bridges (drop file, walk events).
- New services: `driveScanner.js` (indexed walk), `staleDetector.js` (rules and
  scoring). Extend `trashAdvisor.js` and `cleanupPlanner.js`.
- `src/settingsStore.js`: pin-raccoon flag, scan roots, exclusion safelist,
  dedup-hashing opt-in.

---

## 9. Phased Milestones

1. **M1 Art and animation core.** New sprite sheet, variable-frame CSS, renderer
   state machine with smooth transitions. (In progress.)
2. **M2 Ambient charm.** Pet, nap, perk-on-return, ambient idle loops, greetings.
3. **M3 Direct manipulation.** File drop onto raccoon and bin, single-file sort.
4. **M4 Proactive movement.** Animated window walking, peek and point behaviors,
   pin setting.
5. **M5 Declutter engine.** Drive scanner, stale detection, scoring, exclusion
   zones, quarantine piles, panel surfacing.
6. **M6 Optional dedup.** Opt-in local content hashing with clear disclosure.

---

## 10. Open Decisions

- Default scan roots beyond Downloads (Desktop, Documents, a user-picked set?).
- Quarantine retention policy (auto-clear after N days, or manual only?).
- Whether movement is on by default or opt-in.
- Thresholds for "old" and "large" (sensible defaults plus settings).
