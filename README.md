# Download Raccoon

Download Raccoon is a tiny Electron desktop companion that watches your Downloads folder and helps sort loose files into cute local piles.

## Run

```powershell
npm install
npm start
```

If PowerShell blocks `npm.ps1`, use the Windows command shim:

```powershell
npm.cmd install
npm.cmd start
```

## Smoke Test

The service smoke test does not require Electron. It creates temporary files, scans them, moves them into `Raccoon Piles`, and verifies duplicate names do not overwrite existing files.

```powershell
npm.cmd run smoke
```

## Pixel Assets

The raccoon is generated as local PNG pixel art from `scripts/generate-pixel-assets.js`.

```powershell
npm.cmd run assets
```

## MVP Behavior

- A transparent always-on-top raccoon appears automatically.
- The companion uses local pixel-art PNG sprites, including idle, notice, carry, sweep, buried, celebrate, sleep, and thinking frames.
- The raccoon has separate cursor-follow pupils, occasional idle tricks, and a tiny trash-bin animation.
- The raccoon can be dragged and its position is saved.
- The tray can hide, show, pause, scan, open piles, or quit.
- The app watches the default Downloads folder.
- New completed files trigger a raccoon reaction.
- Clicking the raccoon opens the pile panel.
- The panel shows a local rule-based cleanup plan with ready crumbs, review crumbs, and smarter sub-piles such as screenshots, receipts, old installers, large videos, and possible duplicate-looking files.
- The panel shows metadata-only trashpanda toss hunches for review, such as old installers, stale screenshots, old archives, large old files, empty files, leftovers, and possible duplicate-looking files.
- Sorting requires user confirmation and only moves selected files.
- Toss hunches are recommendations only; the app still does not delete files.
- Files are moved into `Downloads/Raccoon Piles/<Category>`.
- Existing destination names get a number, such as `photo 2.png`.
- The app never deletes files, never reads file contents, and makes no network requests.
