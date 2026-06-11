# TrashPanda Cleanup Rules

The rule set the raccoon uses to suggest what to delete and how to organize a
folder. Everything here is local and rule-based. No internet, no AI, no content
reading by default. Suggestions only, never automatic deletion, always reversible.

---

## 1. Triggers

1. **Downloads watcher (always on).** The existing live watch on the Downloads
   folder. Reacts immediately to new files and runs incremental rule checks.
2. **Manual folder analyze (new).** The user points the raccoon at any folder via
   a native "Analyze folder..." picker (tray menu and panel button). Runs a
   one-off recursive scan of that folder, honoring the exclusion zones.

Both feed the same rule engine and produce the same result model (section 4).

---

## 2. Deletion Suggestion Rules

Each rule inspects file metadata only (name, extension, size, modified time,
created time, path, and sibling files/folders). Access time is used only as a
weak hint because Windows often disables it. Each match produces a hunch with a
weight and a plain-language reason. A file can match several rules; weights add up.

| # | Rule | Condition (metadata only) | Weight | Reason shown |
| --- | --- | --- | --- | --- |
| 1 | Old installer | ext in exe, msi, dmg, pkg, appimage, deb AND (name matches setup/install/installer OR located in Downloads) AND modified > 60 days | 0.45 | "Installer you have already run." |
| 2 | Stale large file | size > 100 MB AND modified > 180 days | 0.30 + size/age bonus | "Large and untouched for months." |
| 3 | Extracted archive | ext in zip, rar, 7z, tar, gz AND a sibling folder shares the base name AND modified > 30 days | 0.40 | "Already extracted to a folder nearby." |
| 4 | Temp or partial | ext in tmp, part, crdownload, download OR name ends with .partial | 0.50 | "Leftover temporary or unfinished file." |
| 5 | Empty | size is 0 bytes, or an empty folder | 0.35 | "Empty, nothing inside." |
| 6 | Old screenshot | name matches screenshot/capture/^IMG_ AND ext in png, jpg, jpeg AND modified > 90 days | 0.25 | "Old screenshot you likely forgot." |
| 7 | Duplicate (cheap) | same size AND normalized name match (strip " (1)", " - copy", " copy") with another scanned file | 0.30 | "Looks like a copy of another file." |
| 8 | Redundant versions | 3 or more files in one folder share a stem with version suffixes (copy, (1), v2, final, final2) | 0.25, keep newest | "Several versions of the same thing." |
| 9 | Aged media | ext in mp4, mov, avi, mkv AND size > 50 MB AND modified > 180 days | 0.25 | "Big video untouched for months." |
| 10 | Old log or cache | ext in log, cache, dmp AND modified > 30 days | 0.30 | "Stale log or cache file." |

**Optional strong duplicate pass.** A content hash confirms true duplicates, but
it reads bytes, which crosses the no-content-reading default. It is opt-in,
clearly labeled, and still fully local.

### Confidence and sorting

`confidence = clamp(sum of matched weights, 0, 1)`

- `>= 0.75` very likely junk
- `0.50 to 0.75` likely
- `< 0.50` maybe

The panel sorts very likely first so the user can clear obvious junk in seconds
and ignore the long tail. Each item also shows reclaimable size.

---

## 3. Organization Suggestion Rules

The goal is a proposed tidy-up for a folder, expressed as a preview of moves the
user can accept or reject. No files leave, nothing is deleted, every move is
logged for undo.

| # | Rule | When it fires | Suggestion |
| --- | --- | --- | --- |
| 1 | Type bucketing | Many loose files of mixed types in one folder | Create subfolders by category (Images, Documents, Archives, Installers, Audio, Video, Code) and move files in. A bucket is only suggested if it would hold at least 4 files. Uses the existing fileCategorizer. |
| 2 | Date bucketing | Files span a wide date range (common for screenshots and photos) | Offer Year or Year/Month subfolders as an alternative scheme to type bucketing. |
| 3 | Project grouping | 3 or more files share a name prefix or were created in a tight time window | Group them into a named subfolder (for example invoice_* into /Invoices). |
| 4 | Flatten nesting | A folder contains exactly one subfolder and little else | Suggest flattening to remove a redundant level. |
| 5 | Loose-file threshold | The folder root has more than 20 loose files and no subfolders | Recommend organizing. If it already uses typed subfolders, say it looks tidy instead. |
| 6 | Naming normalization | Inconsistent spacing or casing across many files | Offer a rename scheme. Lower priority, opt-in, reversible. |

Rules respect existing structure: if files are already mostly inside sensible
subfolders, the engine does not propose re-bucketing.

Each organization suggestion carries: the scheme name, the full list of proposed
moves (source to destination), the count of files affected, and a one-line
rationale. The user previews and confirms before anything moves.

---

## 4. Result Model

A scan of Downloads or a manual folder returns:

```
{
  "root": "C:/Users/.../Downloads",
  "scannedAt": "2026-06-11T10:00:00Z",
  "deletions": [
    { "path": "...", "rules": ["old_installer"], "confidence": 0.82,
      "reason": "Installer you have already run.", "bytes": 245788672 }
  ],
  "organization": [
    { "scheme": "type_buckets", "filesAffected": 38,
      "rationale": "31 loose files across 5 types.",
      "moves": [ { "from": "...", "to": "Images/..." } ] }
  ],
  "summary": { "reclaimableBytes": 1288490188, "deletionCount": 12, "orgPlans": 2 }
}
```

The raccoon enters `found_excited` (see the animation spec) when there is at least
one very-likely deletion or an organization plan. Clicking the raccoon opens the
panel with this result.

---

## 5. Safety and Privacy (applies to every rule)

- Local only. No network calls, ever. No AI. Pure rules over metadata.
- Metadata only by default. Optional duplicate hashing is local and opt-in.
- Never delete. Suggested deletions move to a reversible quarantine pile.
- Every organization move is logged so the whole plan can be undone.
- Hard exclusion zones: Windows, Program Files, AppData program data, .git,
  node_modules, cloud-sync folders, plus a user safelist. The manual picker
  refuses to scan inside these.
- Always confirm before any move. Skip locked or in-use files gracefully.

---

## 6. Service Mapping

- `downloadScanner.js`: keep for live Downloads watching.
- `driveScanner.js` (new): recursive metadata walk for the manual folder trigger,
  with exclusion handling and a cached index.
- `staleDetector.js` (new): the deletion rules and confidence scoring above.
- `fileCategorizer.js`: reused by the organization type-bucketing rule.
- `cleanupPlanner.js`: builds the organization move plans.
- `trashAdvisor.js`: assembles the result model the panel and companion consume.
- `historyStore.js`: move log for undo.
