# Testing

Palm OS was verified by driving the production build in a real browser
(headless Firefox over WebDriver BiDi) and asserting against the live DOM —
not by inspecting source. Every item below was executed; the bugs listed at the
end were found that way and fixed.

## What was verified

### Boot and persistence
- Cold boot on an empty profile seeds the filesystem and renders the desktop,
  icons and taskbar with **zero console errors or warnings**.
- Settings (theme, accent, wallpaper, contrast, motion, taskbar position),
  desktop icon positions, files, folders and notes all survive a reload.
- Boot with IndexedDB unavailable shows the failure screen rather than hanging.

### Window manager
- Twelve applications opened simultaneously: unique z-order, exactly one
  focused window, taskbar tracking all twelve.
- Move by title bar; the store commits once on release.
- Resize from all eight edges and corners, including the minimum-size clamp
  (a 780px window clamps at its 380px minimum).
- Snap: drag to an edge shows the preview label ("Left half", "Top-left
  quarter"), release applies the exact geometry (700×852 on a 1400×900
  viewport).
- Minimise, restore from the taskbar, maximise (fills the work area), restore
  to the previous size, `Alt + Tab` focus cycling, close-all.

### Filesystem
- Create folder and file, inline rename, move to Trash, Trash listing, restore
  from the context menu (verified back in its original folder), permanent
  delete, empty Trash.
- Grid and list views, sortable columns, per-folder search.
- Drag a file between folders; drag real files in from the host OS.
- **300 files in one folder**: the list renders 32 rows, recycles correctly
  while scrolling (rows 0–31 → 158–189 → 276–299) and reports the true count.
- Empty folders, empty Trash and a missing path all render their own states.

### Shell
```
mkdir -p /Documents/smoke && ls /Documents      # sequences
echo "hello" > /tmp.txt ; cat /tmp.txt          # redirection
cat /Desktop/Welcome.txt | grep Palm | wc       # pipelines
cd /Documents/smoke ; pwd                       # working directory
nosuchcmd || echo fallback-ran                  # conditional execution
neo<Tab>                                        # completion → "neofetch "
<ArrowUp>                                       # history recall
```
All pass, plus `neofetch`, `systeminfo`, `df`, `tree`, `find`, `sudo`.

### Applications
- Calculator: `sqrt(144) + 2^5 * (3 - 1)` → 76; `5/0` → "Cannot divide by
  zero"; `ln(0)`, `2 +`, `nope(2)` → specific messages; unary minus, `%`, `pi`,
  radians/degrees, history, keyboard entry.
- Text Editor: open, edit, autosave, find/replace (4 matches found and
  replaced), undo → redo → undo round trips, save-as, rename,
  unsaved-changes guard, live word/character count.
- Notes: create, autosave, search, pin, export to Documents.
- Browser: tabs, address parsing, `javascript:`/`data:` rejection, bookmarks,
  history, internal `palm:` pages.
- Image Viewer: opening a seeded image prompts for permission, then decodes it
  from a blob URL at its true 1200px natural width.
- Files, Settings, Calendar, Media Player, System Monitor and App Store all
  launch, render and respond.

### Crash isolation
A deliberately throwing application was registered, built and launched. It
showed "Application stopped responding" with Restart and Close; the taskbar,
desktop and other applications kept working, and new applications still
launched. The test application was then removed.

### Permissions
Opening a document in the Text Editor prompts: *"Allow Text Editor to use
Files?"* with the app identity, the capability description, the app's stated
reason and "Remember this decision". Allowing loads the file; a second document
does **not** re-prompt. The grant appears in Settings ▸ Applications and toggles
Allowed → Blocked → Ask.

### Backup
Export produces `palm-os-backup-YYYY-MM-DD.json` containing the node graph,
text contents, base64-encoded binaries and the key/value space. A round trip
was verified: export, delete a file and add another, import, confirm the
deleted file is back with its original contents and the later addition is gone.
The validator rejects non-Palm files, missing parents and folder cycles.

### Responsive
At 390×844 with touch: windows are full-screen with no resize handles, the
taskbar grows to 56px, and Notes, Files and Settings each collapse to a single
pane with back navigation. No horizontal overflow at any tested size
(`scrollWidth === clientWidth`).

Split panes react to **window** width, not viewport width, so a narrow window
on a large display collapses correctly too.

### Accessibility
An automated audit across eight simultaneously-open applications found:
- **0** interactive elements without an accessible name
- **0** unlabelled form controls
- **0** images without `alt`
- 207 keyboard-focusable elements, with landmarks, headings, live regions and
  status roles present

Contrast was measured from the live custom properties:

| Pair | Dark | Light |
| --- | --- | --- |
| Primary text on surface | 15.25 | 16.94 |
| Secondary text on surface | 8.25 | 6.73 |
| Tertiary text on surface | 5.14 | 4.89 |
| Tertiary text on surface-2 | 4.54 | 4.51 |
| Accent text on surface | 5.15 | 4.89 |
| Accent label on accent fill | 5.54 | 5.54 |

All clear WCAG AA (4.5:1). Because the accent is user-chosen, a derived
`--os-accent-ink` is computed at runtime: a garish `#f0e040` on a light theme
becomes `120 112 32` (4.95:1) for text while the fill keeps the chosen colour.

## Bugs found by this process

1. **Every window rendered at 0,0.** The entrance animation used
   `fill: both` with a keyframe ending at `transform: none`, which permanently
   overrode each frame's inline transform. Fixed by moving the animation to an
   inner layer that carries no inline transform.
2. **Resize handles were unclickable.** They straddle the border by design but
   sat inside an `overflow-hidden` frame. Fixed by splitting the frame into an
   unclipped positioning box and a clipped chrome layer.
3. **Every themed colour was transparent.** The Tailwind theme used the v3
   `<alpha-value>` placeholder, which v4 does not substitute, producing invalid
   colours. Window backgrounds were see-through as a result.
4. **The wallpaper vanished** once backgrounds became opaque: its `-z-10`
   escaped to the root stacking context and painted behind the shell.
5. **The terminal prompt lost focus after every command**, because the input
   was `disabled` while busy. Changed to `readOnly`.
6. **`&&`, `;` and `||` were parsed as arguments**, so `mkdir a && ls` tried to
   create files called `&&` and `ls`. The parser now handles sequences.
7. **Stale calculator errors** persisted while typing a new expression.
8. **Implicit permissions displayed as toggleable** when they are always
   granted.
9. **Redo never became available, and Replace All could not be undone.** The
   undo stacks were mutated inside a `setState` updater, which React may run
   lazily, so the derived `canUndo`/`canRedo` flags read stacks that had not
   been touched yet. The mutations were moved out of the updater.

## Reproducing

```bash
npm run build && npm run preview
```

Then exercise the checklist above against `http://localhost:4173`. The
harness used here lives outside the repository; it drives the same build a user
would run.
