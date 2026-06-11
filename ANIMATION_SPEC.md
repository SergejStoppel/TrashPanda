# TrashPanda Animation Spec

Definition of the animation sprites for the raccoon companion. The art is
produced separately (AI-generated pixel frames in the style of the reference
sheet, optionally on a green card). This document defines what animations exist,
what triggers them, how they loop, how many frames each needs, and how they fit
into a priority state machine.

---

## 1. Production Notes (read first)

- **One consistent canvas** for every frame. Suggested source size 128x128, with
  the raccoon's **feet on a fixed baseline** and horizontally centered. Consistent
  anchoring is what makes frames line up when played in sequence.
- **Character on transparent background.** If a green backdrop is wanted, make it
  a separate card behind the character so animations play cleanly over any
  desktop. Do not bake the green into the character silhouette.
- **Sheet layout:** one animation per row, frames left to right. Sheet width is
  `maxFrames * frameSize`. Rows with fewer frames leave trailing empty columns.
  This mirrors the existing `sprite-manifest.json` pattern.
- **Reuse the rest pose.** Generate one canonical idle "rest" frame. Every
  one-shot animation should start and end on that exact frame so it blends back
  to idle and you never regenerate the rest pose.
- **Frame budget realism.** With AI-generated frames, consistency between frames
  is the hard part, so keep counts low. A 2-frame loop ping-pongs (1,2,1,2) to
  feel like 4. Spend extra frames only where motion really needs them.

---

## 2. Frame Philosophy

| Type | Frames | Loop style |
| --- | --- | --- |
| Subtle idle (breathing) | 2 to 4 | ping-pong, loop |
| Ambient activity (reading, eating) | 3 to 4 | loop |
| Quick reaction (click, notice) | 3 to 4 | one-shot, return to idle |
| Action sequence (carry, celebrate) | 4 to 6 | one-shot |
| Hero sequence (analyzing) | 6 | loop while task runs |

fps below is a suggestion. Slow, calm states run at 2 to 4 fps. Lively reactions
run at 6 to 8 fps.

---

## 3. Animation Catalog

### A. Idle and ambient (play when calm and the user is present)

These cycle at random while nothing else is happening. `idle_breathe` is the
default; the others are occasional "tricks."

| Name | Frames | fps | Loop | Description |
| --- | --- | --- | --- | --- |
| idle_breathe | 4 | 4 | ping-pong | Gentle chest rise and fall, tail sways. Frame 4 is a blink. The canonical rest pose is frame 1. |
| read_book | 4 | 3 | loop | Holds a small book, turns a page on the last frame, eyes scan. |
| drink_tea | 5 | 4 | one-shot | Lifts mug, sips (steam puff), lowers mug, content sigh. |
| eat_cookie | 4 | 5 | loop | Nibbles a cookie, crumbs fall, cheeks puff. (Matches reference pose.) |
| groom | 4 | 6 | loop | Licks paw, wipes over ear and face. |
| look_around | 4 | 4 | one-shot | Head turns left, right, sniffs the air, settles. |
| tail_flick | 2 | 3 | loop | Just the ringed tail flicking. Cheap personality filler. |
| stretch | 4 | 6 | one-shot | Big arms-up stretch, then settle. Good after waking. |

### B. Sleep and presence (driven by how long the user has been away)

| Name | Frames | fps | Loop | Description |
| --- | --- | --- | --- | --- |
| yawn | 4 | 5 | one-shot | Mouth opens wide, eyes squeeze, slumps. Bridges idle into sleep. |
| sleep | 4 | 2 | loop | Nightcap on, curled up, slow breathing, floating Z's. (Matches reference.) |
| wake | 4 | 5 | one-shot | Eyes blink open, rubs face, sits up. Leads into stretch or greet. |
| greet_wave | 5 | 6 | one-shot | Enthusiastic wave with sparkle. Plays on launch and when the user returns. (Matches reference.) |
| return_stretch | 3 | 5 | one-shot | Quick perk-up when the user comes back mid-session. |

### C. User-action reactions

| Name | Frames | fps | Loop | Description |
| --- | --- | --- | --- | --- |
| click_react | 3 | 7 | one-shot | Ears perk, quick happy blink toward the cursor. Plays on a normal click. |
| pet | 4 | 6 | loop | Click-and-hold. Leans into it, eyes closed, blissful wiggle, tail wag, little hearts. |
| drag_hold | 3 | 4 | loop | While the window is being dragged. Limbs and tail dangle and swing. |
| present_reco | 4 | 6 | one-shot | Holds up a found item or points at a clipboard while the recommendation bubble opens. |

### D. File and download reactions

| Name | Frames | fps | Loop | Description |
| --- | --- | --- | --- | --- |
| notice | 4 | 7 | one-shot | Snaps head toward a new file, ears up, a "!" pops. |
| watch_download | 3 | 4 | loop | Watches a download progress, tail wagging with anticipation. |
| carry_sort | 6 | 6 | one-shot | Picks up a file, shuffles over, drops it on the pile, dusts paws. (Bag pose from reference fits the carry.) |
| celebrate | 6 | 7 | one-shot | Pops out of the trash can, confetti, big grin. Plays on a finished sort or big cleanup. (Matches reference.) |
| toss_trash | 5 | 6 | one-shot | Lobs a crumpled file into the bin, lid clatters. For confirmed throwaways. |

### E. Keyboard and presence reactions

| Name | Frames | fps | Loop | Description |
| --- | --- | --- | --- | --- |
| cowork_type | 4 | 8 | loop | When the user is typing fast, the raccoon taps away on its own tiny laptop, hood up. (Matches reference laptop pose.) Keeps the companion feeling alive without distracting. |

Presence handling: sustained no-input drifts through `yawn` into `sleep`; the
first input afterward plays `wake` then `return_stretch`.

### F. Analyze and suggest flow (the hero sequence)

Triggered when a folder scan begins (app-initiated, or when the user opens a
watched folder). Plays as a chain:

1. **analyze_start** (3 frames, 6 fps, one-shot): perks up, pulls out a
   magnifying glass and clipboard.
2. **analyzing** (6 frames, 5 fps, loop): rummages through a little pile, flips
   papers, sniffs, jots notes. Loops for as long as the scan runs.
3. Branch on result:
   - **found_excited** (4 frames, 6 fps, loop): bounces on the spot, eyes
     sparkle, holds up a "!" sign. Loops until the user clicks the raccoon. This
     is the "I found something to clean" attractor state.
   - **all_clean** (3 frames, 5 fps, one-shot): satisfied nod and a thumbs-up,
     then back to idle. Nothing to suggest.
4. On click during `found_excited`: play **present_reco** (section C) and open
   the recommendation bubble or panel.

---

## 4. State Machine: Priority and Interrupts

Higher priority interrupts lower. Equal priority lets the current one finish.

| Priority | Group | Notes |
| --- | --- | --- |
| 5 (highest) | celebrate, toss_trash, present_reco | Payoff moments. Always play to completion. |
| 4 | notice, found_excited, analyze_start | Important signals. Interrupt idle and ambient. |
| 3 | carry_sort, analyzing, watch_download, cowork_type | Task states. Run while their task runs. |
| 2 | pet, click_react, drag_hold, greet_wave, wake, return_stretch | Direct interaction. Interrupt idle. |
| 1 | yawn, sleep | Presence drift. Only from idle. |
| 0 (lowest) | idle_breathe, read_book, drink_tea, eat_cookie, groom, look_around, tail_flick, stretch | Ambient. Interrupted by anything above. |

Rules:
- One-shots return to `idle_breathe` (or `sleep` if the user is still away).
- `found_excited` loops and ignores ambient timers until clicked or dismissed.
- `pet` overrides everything except priority 5 while the hold is active.

---

## 5. Manifest Schema

Extend the existing `sprite-manifest.json` so the renderer is data-driven and you
can add animations without touching code:

```json
{
  "frame": 128,
  "scale": 1.0,
  "sheetWidth": 768,
  "sheetHeight": 3328,
  "maxFrames": 6,
  "animations": {
    "idle_breathe": { "row": 0, "frames": 4, "fps": 4, "loop": "pingpong", "priority": 0, "returnTo": "idle_breathe" },
    "analyzing":    { "row": 18, "frames": 6, "fps": 5, "loop": "loop", "priority": 3, "returnTo": "idle_breathe" },
    "found_excited":{ "row": 20, "frames": 4, "fps": 6, "loop": "loop", "priority": 4, "returnTo": "idle_breathe" },
    "present_reco": { "row": 15, "frames": 4, "fps": 6, "loop": "once", "priority": 5, "returnTo": "idle_breathe" }
  }
}
```

Fields: `loop` is one of `loop`, `pingpong`, `once`. `priority` drives the state
machine table above. `returnTo` is the resting animation after a `once`.

---

## 6. MVP Subset (generate these 12 first)

Enough to ship a lively, useful companion before drawing all 26:

1. idle_breathe (with blink frame)
2. greet_wave
3. notice
4. analyze_start
5. analyzing
6. found_excited
7. present_reco
8. celebrate
9. carry_sort
10. pet
11. yawn
12. sleep

That covers idle, the full analyze-to-suggestion loop, a file reaction, a payoff,
petting, and the sleep cycle. Add ambient flavor (read_book, drink_tea,
eat_cookie, cowork_type) and the rest in a second pass.

---

## 7. Frame Count Summary

| Group | Animations | Total frames |
| --- | --- | --- |
| Idle and ambient | 8 | 27 |
| Sleep and presence | 5 | 20 |
| User actions | 4 | 14 |
| File and download | 5 | 24 |
| Keyboard | 1 | 4 |
| Analyze and suggest | 4 | 16 |
| **Total** | **27 rows** | **~105 frames** |

(present_reco is shared between groups C and F, so 26 distinct animations across
27 catalog entries.)

---

## 8. Mouse Follow

Three ways to make the raccoon track the cursor, from cheapest to most alive.
They stack, so a good result is options 1 and 2 together.

### Option 1: Whole-body lean (no extra art, works now)

The app already reads the cursor and sets `--look-x` and `--look-y`. The sprite
translates a few pixels toward the cursor with a stepped transition. Works over
any animation frame because it just nudges the whole image. Subtle but free.
Keep the offset small (3 to 5 px) so it reads as attention, not sliding.

### Option 2: Directional look poses (recommended for the AI-art pipeline)

Generate a small set of single-frame head-direction variants of the rest pose and
swap them based on which sector the cursor is in relative to the raccoon, with a
center deadzone so it does not jitter.

- Minimum 5 poses: look_center (the rest pose), look_left, look_right, look_up,
  look_down.
- Nicer 9 poses: add the four diagonals for a full 3x3 gaze grid.

These are static poses, not loops. The app picks one by cursor angle and can
cross-swap instantly or with a one-frame ease. Combine with Option 1 so the eyes
pick the direction and the body leans into it. Only active while idle or calm;
action animations ignore the cursor.

Frame cost: 5 (or 9) extra poses. Add them to the art list as a `look_*` block.

### Option 3: Overlay pupils for true analog tracking (optional, later)

Generate the idle face with blank white eyes and no pupils, plus one tiny pupil
sprite. The app moves the pupils within the eye region by cursor angle, clamped
to the socket, for smooth continuous tracking. This only works on poses with a
fixed eye position, so use it on the idle rest pose and bake eyes into every
other animation. Most lifelike, but it constrains how the idle face is drawn.

### Recommendation

Ship Option 1 immediately (already wired). Add the 5 `look_*` poses from Option 2
to the MVP art so the gaze is expressive. Consider Option 3 only if you want
premium eye tracking on the idle pose later.

Note: physically walking toward the cursor is a different feature (proactive
window movement) and is tracked in the implementation plan, not here.
