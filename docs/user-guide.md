# Synkban User Guide

Synkban is a **local-first, keyboard-driven kanban board and structured note-taking workspace** whose data lives as plain JSON files and standalone attachment files on your disk. There is no database, no cloud account, and no vendor lock-in — you own your boards completely and can sync them with whatever tool you already trust.

> **Shortcut notation:** Throughout this guide, **`Cmd/Ctrl`** means **`Cmd` (`⌘`) on macOS** and **`Ctrl` on Windows and Linux**. Press **`?`** anywhere outside a text field to open the contextual in-app shortcut reference.

## Table of Contents

- [Why Synkban?](#why-synkban)
  - [Core Advantages](#core-advantages)
  - [Intentional Scope](#intentional-scope)
- [Getting Started & Ways to Run Synkban](#getting-started--ways-to-run-synkban)
  - [Desktop Mode (macOS, Linux, Windows)](#desktop-mode-macos-linux-windows)
  - [Web Mode (Standalone Binary)](#web-mode-standalone-binary)
  - [Self-Hosting with Docker & Installing as a PWA](#self-hosting-with-docker--installing-as-a-pwa)
  - [Two-Minute Walkthrough](#two-minute-walkthrough)
- [Core Concepts](#core-concepts)
- [Managing Boards](#managing-boards)
  - [Board Overview](#board-overview)
  - [Board Top Bar & Personalisation](#board-top-bar--personalisation)
  - [Switching Boards & Session Memory](#switching-boards--session-memory)
- [Kanban Mode & Notes Mode](#kanban-mode--notes-mode)
  - [Kanban Mode](#kanban-mode)
  - [Notes Mode](#notes-mode)
- [Lists & Cards](#lists--cards)
  - [Working with Lists](#working-with-lists)
  - [Adding Cards & Quick-Add Syntax](#adding-cards--quick-add-syntax)
  - [Title Formatting](#title-formatting)
  - [Moving & Reordering (Mouse, Keyboard & Touch)](#moving--reordering-mouse-keyboard--touch)
- [Working Inside a Card](#working-inside-a-card)
  - [Deliberate Saves & Unsaved Changes Guard](#deliberate-saves--unsaved-changes-guard)
  - [Rich-Text Description Editor](#rich-text-description-editor)
  - [Tables & Matrices](#tables--matrices)
  - [Inline Images](#inline-images)
  - [Labels & Label Drawer](#labels--label-drawer)
  - [Due Dates & Keyboard-First Picker](#due-dates--keyboard-first-picker)
  - [Checklist](#checklist)
  - [Attachments](#attachments)
  - [Card History & Diffs](#card-history--diffs)
  - [Archival PDF/A Export](#archival-pdfa-export)
- [Filtering Cards](#filtering-cards)
- [Archiving & Permanent Deletion](#archiving--permanent-deletion)
- [Syncing, Backups, Crash Safety & Resilience](#syncing-backups-crash-safety--resilience)
  - [Data Directory vs. Config Directory](#data-directory-vs-config-directory)
  - [Syncing Across Devices](#syncing-across-devices)
  - [Backups & Migration](#backups--migration)
  - [Crash-Safe Drafts](#crash-safe-drafts)
  - [Data-Integrity Warnings & Offline Resilience](#data-integrity-warnings--offline-resilience)
- [Settings & Appearance](#settings--appearance)
- [Keyboard Shortcuts Reference](#keyboard-shortcuts-reference)
- [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Why Synkban?

Most kanban and note-taking apps store your work inside an opaque cloud database or a monolithic local database file. That makes true file-based syncing fragile, backups awkward, and long-term ownership uncertain.

Synkban is designed around a different idea: **every board, list, card, and attachment is a separate, human-readable file in a folder you control**, paired with a fast, distraction-free interface that works equally well with the keyboard, mouse, or touch.

### Core Advantages

- **Plain files, zero lock-in:** Your boards, lists, and cards are plain JSON files on disk — no database server, no account required, no proprietary format. You can back everything up by copying a folder or inspect and repair any file with a standard text editor.
- **Conflict-friendly file sync:** Each card is its own JSON file, and every attachment is stored alongside its own metadata sidecar instead of inside the card file. Editing different cards on two devices (or uploading attachments while editing) does not clash, making Synkban work naturally with **Syncthing, Dropbox, iCloud Drive, Nextcloud, Git, or rsync**.
- **Live external change awareness:** Synkban checks your Data Directory every 15 seconds for external changes made by your sync tool and refreshes your view automatically — without interrupting active typing or losing your keyboard focus.
- **Kanban Mode and Notes Mode on the same cards:** Manage visual workflows across side-by-side lists in **Kanban Mode**, or press `V` to switch any board to **Notes Mode** — turning lists into **List Tabs** and displaying a full **Notes Pane** beside the card list so you can read and write long-form cards continuously without opening and closing modals.
- **Keyboard-first across every platform:** Almost everything — navigating boards and cards, reordering, quick-adding with `#label` and `due:`, picking dates, formatting text, building tables, viewing history, and exporting PDFs — can be driven from the keyboard on macOS, Linux, and Windows without shortcut conflicts or OS-specific guesswork.
- **Deliberate atomic saves with crash safety:** Card content saves only when you click **Save** (`Cmd/Ctrl + S`), preventing half-typed sentences from triggering sync storms or cluttering version history. At the same time, unsaved edits of the open card are safeguarded locally in a crash draft so an unexpected close or reload never costs your work.
- **Two-step safety against accidental loss:** Boards and cards are always **Archived** before they can be permanently deleted. Even deleting a list archives its cards safely rather than destroying them.
- **Built-in 100-version card history:** Every content change records a snapshot (up to the last 100 versions per card), complete with a field-by-field diff viewer.
- **Offline archival PDF/A-2u export:** Export any card to a self-contained, standards-compliant PDF/A-2u document with embedded fonts, clickable links, formatted tables/matrices, checklists, and inline images — with no browser print quirks or external dependencies.
- **Runs anywhere you work:** Use it as a native **Desktop Mode** window on macOS, Linux, and Windows, as a standalone single-binary local server, or self-hosted in Docker and installed as a **Progressive Web App (PWA)** on desktop and mobile devices.

### Intentional Scope

Knowing what Synkban deliberately omits helps decide whether it fits your workflow:

- **Single-user / personal design:** Synkban has no user accounts, role permissions, or real-time collaborative cursors. In **Web Mode**, the server has no built-in login screen — run it on your local machine, over a private network (such as Tailscale), or behind an authenticating reverse proxy (see [Self-Hosting & Docker Guide](docker/README.md)).
- **Focused data model:** Cards support one flat **Checklist** (not nested sub-checklists), clean simple **Tables** and **Matrices** (no merged cells or drag-resized columns), and a strict, safe rich-text format (no arbitrary raw HTML or script links). This keeps syncing predictable, history diffs clean, and PDF exports crisp.

---

## Getting Started & Ways to Run Synkban

### Desktop Mode (macOS, Linux, Windows)

Pre-built Desktop Mode installers are published on GitHub Releases:

| Platform | Available Packages |
| --- | --- |
| **macOS (Apple Silicon)** | `.dmg` installer and `.zip` archive |
| **Linux** | `.AppImage` and `.deb` |
| **Windows** | `.exe` installer (NSIS) |

You can also package Desktop Mode directly from source with `./build.sh --desktop` (output lands in `electron/dist/`).

> **macOS Gatekeeper note:** Because release builds are not notarised with a paid Apple Developer certificate, macOS may warn that `Synkban.app` *"is damaged and can't be opened"*. Run this command once in Terminal to clear the quarantine attribute, then open Synkban normally:
>
> ```bash
> sudo xattr -cr /Applications/Synkban.app
> ```

**Desktop Mode highlights:**

- **Seamless coloured window:** The app's top bar doubles as the window title bar and adapts to the active board's colour and theme.
- **Remembers window geometry:** Window size, position, and maximised (Windows/Linux) or fullscreen (macOS) state are restored on relaunch, and automatically fitted onto available displays if an external monitor is disconnected.
- **Per-launch local security:** Each launch binds only to `127.0.0.1` on a random port with a fresh secret token so other local apps or browser tabs cannot access your boards.
- **Native integration:** External links in card descriptions open in your operating system's default browser, and **Settings** provides a native folder picker for choosing your synced **Data Directory**.

### Web Mode (Standalone Binary)

Synkban compiles into a single self-contained binary with all web assets embedded. Run it directly from a terminal (or build it yourself with `./build.sh`):

```bash
./synkban
```

Then open **`http://localhost:8080`** in your browser.

#### Command-Line Options & Environment Variables

| Option / Variable | Default | Description |
| --- | --- | --- |
| `--data-dir <path>` | *(see below)* | Path to the **Data Directory** (also accepts `--data-dir=<path>`). Takes precedence over `DATA_DIR` and config file. |
| `-h`, `--help` | — | Print CLI usage help and exit. |
| `-V`, `--version` | — | Print the Synkban version and exit. |
| `DATA_DIR` | *(see below)* | Path to the **Data Directory** (created automatically if absent). |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in the official Docker image). |
| `PORT` | `8080` | Bind port. |
| `SYNKBAN_CONFIG_DIR` | `~/.config/synkban` | Directory for machine-local settings (`synkban.toml`) and crash drafts (`draft.json`). Uses `%USERPROFILE%\.config\synkban` on Windows; `/app/config` in Docker. |

Example running on a custom port and folder:

```bash
HOST=0.0.0.0 PORT=3000 DATA_DIR=/home/me/Sync/synkban ./synkban
```

### Self-Hosting with Docker & Installing as a PWA

Official multi-architecture (`linux/amd64`, `linux/arm64`) container images are published to `ghcr.io/waschmittel/synkban`.

For local or private-network (e.g. Tailscale) use:

```sh
docker run -d \
  --name synkban \
  -p 127.0.0.1:8080:8080 \
  -e DATA_DIR=/data \
  -v /path/on/host/data:/data \
  -v /path/on/host/config:/app/config \
  ghcr.io/waschmittel/synkban:latest
```

> **Important:** The container runs as non-root user `app` (UID `10001`). Ensure host-mounted data and config directories are writable by UID `10001` (for example, `chown -R 10001:10001 /path/on/host/data /path/on/host/config`).

To expose Synkban over HTTPS with persistent single-prompt login and install it as a standalone **Progressive Web App (PWA)** on desktop browsers, Android, or iOS/iPadOS, follow the complete **[Self-Hosting & Docker Guide (Traefik + Tinyauth PWA)](docker/README.md)**.

### Two-Minute Walkthrough

1. Launch Synkban and press **`N`** (or click **Create new board**) to create your first **Board**.
2. Press **`L`** (or click **Add list**) to add lists such as *To Do*, *Doing*, and *Done*.
3. Press **`N`** to add a **Card**, and try **Quick-add** syntax directly in the title:
   ```text
   Prepare launch notes #work #urgent due:fri
   ```
   Press `Enter` — Synkban strips the tokens, creates the `#work` and `#urgent` labels if needed, sets the due date to next Friday, and focuses the new card.
4. Press **`Enter`** on the card to open the **Card Modal**. Add rich text notes, a checklist (`Cmd/Ctrl + L`), or drop a file onto the card to attach it. Press **`Cmd/Ctrl + S`** to save.
5. Press **`Cmd/Ctrl + P`** to export the card to an archival PDF, or close the modal (`Esc`) and press **`V`** to switch into **Notes Mode** and edit cards inline beside the list.

---

## Core Concepts

| Term | What it means in Synkban |
| --- | --- |
| **Board** | Top-level workspace with its own title, optional colour, **Labels**, **Lists**, and default view mode (**Kanban Mode** or **Notes Mode**). |
| **List** | An ordered column (or tab in **Notes Mode**) on a board holding **Cards**. |
| **Card** | An individual work item or note inside a list. Holds a title, **Labels**, **Due Date**, rich-text **Description**, **Checklist**, **Attachments**, and **History**. |
| **Label** | A coloured tag defined per board. Display order is shared across the board, card faces, card detail, and Filter Bar. |
| **Archive** | Safe holding area for soft-deleted boards and cards. Items must be archived before they can be permanently deleted. |
| **Data Directory** | The folder where all boards, lists, cards, and attachments are stored (`boards/`). This is the folder you back up and sync across devices. |
| **Config Directory** | Machine-local folder (`~/.config/synkban` by default) holding your **Settings** (`synkban.toml`) and crash-recovery **Draft** (`draft.json`). Kept local — never synced. |

---

## Managing Boards

### Board Overview

The home screen (**Your Boards**) shows all active boards in a grid. Each board card displays:

- **Title** and **board colour**
- **Total active cards** on that board
- **Overdue card count** (highlighted when one or more cards have a due date before today)
- **Last edited** relative timestamp (hover to inspect the exact local date and time)

From the Board Overview you can:

- **Create a board:** Click **Create new board** or press **`N`**, enter a title, and press `Enter`.
- **Open a board:** Click a board card, or navigate with `↑` `↓` `←` `→` and press `Enter`.
- **Reorder boards:** Drag and drop a board card (long-press on touch devices), or focus a board and press **`Shift + ↑ / ↓ / ← / →`**.
- **Archive a board:** Hover and click the archive icon, or focus a board and press **`Del`** / **`Backspace`** (asks for confirmation first).
- **View Archived Boards:** Click **Archive** (shows the count when non-empty) or press **`A`** to restore or permanently delete archived boards.

### Board Top Bar & Personalisation

Inside any board, the top bar gives quick access to board-wide controls:

- **Back to boards (`<` / `B`):** Return to the Board Overview.
- **View switcher (`Board` / `Notes` / `V`):** Toggle between **Kanban Mode** and **Notes Mode**.
- **Filter (`F`):** Show or hide the **Filter Bar**.
- **Inline board rename:** Click the board's title in the centre of the top bar, edit the name, and press `Enter` (or click away) to save, or `Esc` to cancel.
- **Archived cards (`A`):** Open the **Archive Panel** for this board.
- **Board colour (palette icon):** Open the colour picker and choose any custom colour with live preview across the board background, header, buttons, and focus rings (in both light and dark modes), or click **Reset to default** to return to the classic blue (`#0079bf`).
- **Manage labels (`G`):** Toggle the right-side **Label Drawer**.
- **Keyboard shortcuts (`?`):** Open the contextual shortcut help dialog.
- **Settings (gear icon):** Open **Settings** from any page.

### Switching Boards & Session Memory

When you have two or more active boards, a **Board Dock** appears as a pill of coloured dots pinned at the bottom of the screen (scrollable horizontally when you have many boards):

- Click any dot to jump directly to that board (hover for the board title).
- Press **`,` or `J`** to switch to the previous board, and **`.` or `K`** to switch to the next board (wraps around in Board Overview order).

**Session view memory:** Within your open tab or desktop window, switching between boards remembers per board:

- Your **last focused card**
- Horizontal board scroll and **per-list vertical scroll** positions
- Whether the **Filter Bar** was open and its active text, due-date, and label filters
- Which card was last open in each list in **Notes Mode**

This orientation state lives for the current session only (closing the tab or desktop app resets it cleanly).

---

## Kanban Mode & Notes Mode

Every board remembers its own view mode (**Kanban Mode** or **Notes Mode**) so a board dedicated to writing notes opens in Notes Mode on all your synced devices. Toggle modes anytime with **`V`** or the **Board / Notes** switch in the top bar.

### Kanban Mode

**Kanban Mode** (the default) arranges your lists side by side:

- **At-a-glance card badges:** Cards display their formatted title, assigned **Labels** (in board order), **Due Date** badge, a description icon if the card has notes, **Checklist** progress (`done/total`, highlighted when all items are checked), and **Attachment** count.
- **Collapsed Lists:** Need more horizontal room while keeping a list nearby? Click the collapse chevron (`<`) in a list's header or press **`C`** while focus is inside that list. The list folds into a narrow vertical strip showing its card count and vertical title.
  - Collapsed lists stay fully interactive: drop cards onto the strip (or move focused cards onto it with `Shift + ← / →`) to append them to the bottom of that list.
  - Click the strip or press `Enter` / `C` on it to expand the list again.
  - Collapse state is saved per list and syncs across devices.
- **Sticky-row horizontal navigation:** Pressing `←` / `→` across lists remembers your vertical row index (like a cursor moving across lines of text). Passing through a shorter list, an empty list, or a **Collapsed List** keeps your target row so you land back at the same depth on the next taller list. Moving vertically (`↑` / `↓` / `Home` / `End`) or clicking resets the remembered row.

### Notes Mode

**Notes Mode** turns the board into a distraction-free master-detail workspace built for cards with long descriptions:

- **List Tabs across the top:** Every list appears as a tab showing its card count (`shown/total` while filtering). Click a tab or press **`←` / `→`** to switch lists.
- **Active tab as list header:** Click the active tab (or press **`R` / `F2`**) to rename the list, or click its **`×`** button to delete the list.
- **Move cards across tabs:** Drag any card onto another **List Tab** to append it to the bottom of that list, or press **`Shift + ← / →`** (or **`Shift + Alt + ← / →`** to reorder the tabs themselves).
- **Split master-detail workspace:** The active list sits on the left; the selected card opens inline on the right in the **Notes Pane** (with the description spanning the pane and centred at a comfortable 90-character reading measure). On narrow windows (under 760 px wide), the card list stacks neatly above the Notes Pane.
- **Keyboard flow:**
  - Press `↑` / `↓` to browse cards (when clean, moving focus displays each card immediately; when you have unsaved edits, focus moves without discarding your edits until you choose a card with `Enter` or click).
  - Press **`Enter` or `E`** to jump straight into editing the card's description.
  - Press **`Esc`** from anywhere outside the card (or inside the Notes Pane) to return focus to the selected card in the list — going through the unsaved-changes guard if needed.
- **Save & stay:** Pressing **`Cmd/Ctrl + S`** or clicking **Save** saves in place and displays `"Saved HH:MM"` in the footer without closing the card. A **Revert** button lets you roll unsaved edits back to the saved card.
- **Unsaved changes indicator:** A dot appears both on the card icon in the pane and on the active **List Tab** whenever the open card has unsaved edits.
- **External conflict protection:** If another device syncs a change to the currently open card while you have unsaved edits in the Notes Pane, Synkban keeps your edits safe and displays a banner offering **Load theirs** (or **Save** to keep your version — their version remains accessible in Card History). If the card was archived or deleted elsewhere while dirty, a banner lets you **Restore & save** it back into the active list.

---

## Lists & Cards

### Working with Lists

- **Add a list:** Click **Add list** (shown as a compact vertical strip in Kanban Mode, or inline beside the tabs in Notes Mode) or press **`L`**, type a name, and press `Enter`.
- **Rename a list:** Click the list title (or active **List Tab** in Notes Mode), or focus the list and press **`R`** or **`F2`**. Press `Enter` to save or `Esc` to cancel.
- **Reorder lists:** Drag a list by its column/header to drop it in a new position, or press **`Shift + Alt + ← / →`** while focused on a card or the list's *Add card* button.
- **Collapse / expand a list (Kanban Mode):** Click the collapse chevron or press **`C`**.
- **Delete a list:** Click the `×` button in the list header (or active List Tab). If the list contains cards, Synkban asks for confirmation; deleting the list moves all of its cards safely to **Archived Cards** as **Orphaned Cards**.

### Adding Cards & Quick-Add Syntax

Click **Add card** in any list or press **`N`** (targets the currently focused list, or the first uncollapsed list if none is focused). Press `Enter` to create the card and stay ready to type another, or `Esc` to close the form (your open form draft is preserved across background refreshes).

You can assign **Labels** and a **Due Date** right inside the new card's title using **Quick-add** tokens:

```text
Send tax documents #finance #urgent due:fri
```

- **`#label`:** Adds an existing board label or automatically creates a new one on creation.
  - Matching ignores case, spaces, and dashes: `#in-progress`, `#InProgress`, and `#in progress` all match a label named `In Progress`.
  - `#` must start a word and be followed by a letter — numbers like `#42` or `#2026` stay untouched as literal title text.
- **`due:…`:** Accepts any date expression the **Due Date Picker** understands (`due:2026-12-01`, `due:today`, `due:tomorrow`, `due:fri`, `due:+3d`, `due:+2w`, `due:-1d`). Tokens that cannot be parsed (like `due:someday`) remain literal text in the title.
- **Live preview:** Below the input field, Synkban previews the labels to be applied (existing labels shown solid, new labels to be created shown with a dashed border) and the resolved due date before you press `Enter`.
- **Title required:** A card consisting only of tokens cannot be submitted until you include title text.

### Title Formatting

Both **Card** titles and **Label** names support lightweight inline Markdown formatting:

- Wrap text in `**bold**` or `*italic*`, or select text inside the title/label input and press **`Cmd/Ctrl + B`** or **`Cmd/Ctrl + I`**.

### Moving & Reordering (Mouse, Keyboard & Touch)

Synkban supports three seamless ways to reorder boards, lists, cards, labels, and checklist items:

- **Mouse drag-and-drop:** Drag cards within a list or across lists (including onto **Collapsed Lists** in Kanban Mode or **List Tabs** in Notes Mode), drag lists horizontally, drag boards on the Overview, drag labels in the **Label Drawer**, and drag checklist items inside a card.
- **Keyboard:**
  - `Shift + ↑ / ↓`: Move card up/down (wraps around in Kanban Mode) or reorder labels / checklist items.
  - `Shift + Home / End` (`Shift + PgUp / PgDn`): Move card to the top or bottom of its list.
  - `Shift + ← / →`: Move card to the previous or next list (or List Tab in Notes Mode).
  - `Shift + Alt + ← / →`: Reorder the current list left or right.
- **Touch screens (phones & tablets):** **Long-press** (~220 ms without moving your finger) on any draggable board, list, card, label, or checklist item until it picks up, then drag to the target position (edges auto-scroll near screen borders) and release. Quick taps and normal scrolling continue to work as expected.

---

## Working Inside a Card

Click any card (or focus it and press **`Enter`** or **`Space`** / **`E`**) to open it in the **Card Modal** (in Kanban Mode) or focus the **Notes Pane** (in Notes Mode).

Every section inside a card has a keyboard shortcut to jump directly to it:

- **`Cmd/Ctrl + E`**: Title (`Enter` moves focus down into the Description)
- **`Cmd/Ctrl + U`**: Due Date picker
- **`Cmd/Ctrl + G`**: Labels row
- **`Cmd/Ctrl + D`**: Description editor
- **`Cmd/Ctrl + L`**: Checklist (expands it if empty and focuses the add-item field)
- **`Cmd/Ctrl + O`**: Add Attachment (opens file chooser)
- **`Cmd/Ctrl + J`**: Card History
- **`Cmd/Ctrl + P`**: Export PDF

### Deliberate Saves & Unsaved Changes Guard

A card's **title, labels, due date, description, and checklist** are edited locally and saved together as one atomic update when you click **Save** or press **`Cmd/Ctrl + S`**. (Note: **Attachments** are separate files and persist immediately upon upload or deletion.)

- When edits are unsaved, a dot appears on the card icon at the top left and the footer displays **Unsaved changes**.
- Attempting to close the **Card Modal** (`Esc`, `×`, or clicking outside) or leave a dirty card in the **Notes Pane** opens a confirmation dialog with **Save** (default), **Discard**, and **Cancel** (`Esc`).
- Clearing the card title and trying to save shows an inline error banner reminding you that a card title cannot be empty and returns focus to the title field.

### Rich-Text Description Editor

The description area (styled with a subtle warm note background) gives you structured rich text stored cleanly without raw HTML:

- **Toolbar controls:** Bold, Italic, Inline code, Add or edit link, Insert image, **Text style** dropdown (showing the active style), Insert table, Insert matrix, Undo, Redo, Bulleted list, Numbered list, Quote, Increase/decrease indent.
- **Text Styles:** **Plain text**, **Code block**, **Heading 1**, **Heading 2**, **Heading 3** (selectable via the toolbar dropdown, `Ctrl + Shift + 0 / 1 / 2 / 3 / \`, or the Editor Menu).
- **Markdown typing shortcuts (start of a line):**
  - `# `, `## `, `### ` → Heading 1, 2, 3
  - `- ` or `* ` → Bulleted list
  - `1. ` → Numbered list
  - `> ` → Quote
  - ```` ``` ```` → Code block
  - Press `Backspace` immediately after any auto-conversion to undo it back to plain characters.
- **Nested lists:** Inside a list, press **`Tab`** / **`Shift + Tab`** (or **`Cmd/Ctrl + ]`** / **`Cmd/Ctrl + [`**) to indent or outdent items; press `Enter` on an empty item to exit the list. Outside lists and tables, `Tab` moves focus to the next control as usual.
- **Smart links:**
  - Typing a URL followed by whitespace (`https://…` or `www.…`) automatically creates a clickable link (trailing punctuation stays outside the link).
  - Pasting a URL while text is selected wraps that text as a link; pasting a bare URL inserts it linked.
  - Allowed link schemes: `http:`, `https:`, and `mailto:` (`www.` automatically becomes `https://`). Unsafe schemes are rejected.
  - Plain click opens the link (new tab in Web Mode, default browser in Desktop Mode). **`Cmd/Ctrl + Click`** edits or removes the link (editing always targets the whole link cleanly rather than splitting it).
- **Context-sensitive Editor Menu (`Cmd/Ctrl + K` or Right-Click):**
  - Opens right beside your caret (or pointer) without losing your text selection or touch keyboard.
  - Use **`↑` / `↓` / `Home` / `End` + `Enter`** or press the single-letter/digit shortcut shown next to each item (`L` link, `U` remove link, `I` inline code, `M` insert image, `0` plain, `B` code block, `1`–`3` headings, `T` table, `X` matrix, plus table actions when inside a table).

### Tables & Matrices

Insert structured data directly in any card description using the **Insert table** / **Insert matrix** toolbar buttons or **`Cmd/Ctrl + K`** (`T` for a 3×3 table, `X` for a 3×3 matrix).

- **Tables:**
  - The first row is always the centred **Header Row** (cannot be deleted past being replaced or moved down).
  - Column alignment (**Left**, **Centre**, **Right**) is controlled per column and stays consistent automatically as you add or move rows.
- **Matrices:**
  - Designed for comparison grids and 2D tables: the top-left corner cell is intentionally empty and uneditable, while **both the first row and the first column** act as centred headers.
  - Body cells support **per-cell alignment**.
  - **Transpose (`X` in the Editor Menu):** Swaps rows and columns (headers and cell alignments included) in a single undoable step.
- **Keyboard navigation & editing inside tables/matrices:**
  - `Tab` / `Shift + Tab`: Move to next / previous cell (`Tab` from the very last cell appends a new row automatically; `Shift + Tab` skips the locked top-left corner of a matrix).
  - `Enter`: Move to the same column in the next row (exits the table from the last row).
  - `Shift + Enter`: Insert a line break inside the current cell.
  - **Editor Menu (`Cmd/Ctrl + K` or Right-Click inside a cell):**
    - `W` / `S` / `A` / `D`: Move current row up/down or column left/right
    - `X`: Transpose matrix (matrices only)
    - `Shift + ↑ / ↓ / ← / →`: Insert row above/below or column left/right
    - `1` / `2` / `3`: Align column (or body cell in a matrix) Left / Centre / Right
    - `R` / `C` / `T`: Delete row / delete column / delete table or matrix

In the **Card Modal**, tables span the full editor width; in **Notes Mode**, tables and code blocks grow cleanly to fit their content (scrolling horizontally inside the description if wider than the pane).

### Inline Images

Image attachments can be placed directly inside a card's description as **Inline Images**:

- **Three ways to insert:**
  1. **Paste directly from clipboard** (e.g. a screenshot): pasting an image while your cursor is inside the description uploads it and inserts it at the caret immediately. (Pasting an image anywhere else inside the open card uploads it to the Attachments grid without inserting it into the text.)
  2. **Image Picker (`Cmd/Ctrl + K` then `M`, or toolbar image icon):** Pick any image already attached to the card (press `1`–`9` or `↑` / `↓` + `Enter`) or press **`U`** to upload a new image and insert it.
  3. **From the Attachments grid:** Hover or focus an image tile and click its **`+`** (*Insert into description*) button.
- **Lightbox preview:** Click any inline image to open a full-size preview overlay (`Esc` closes the preview).
- **Copy & paste between cards:** Copying rich text that contains inline images from one card and pasting it into another card automatically duplicates those image attachments onto the destination card so references stay valid everywhere.
- **Automatic cleanup:** Attachments displayed inline show an **`in text`** badge in the Attachments grid. Deleting a referenced attachment asks for confirmation first and automatically strips its inline references from the description.

### Labels & Label Drawer

Labels are colour-coded per board, automatically assigned from a distinct 12-colour pastel palette.

- **Manage Labels (`G`):** Opens the right-side **Label Drawer** where you can:
  - Create new labels (names support `**bold**`/`*italic*` via `Cmd/Ctrl + B` / `Cmd/Ctrl + I`).
  - Rename labels (`Enter` on a focused row or click to edit) and delete labels.
  - **Reorder labels:** Drag rows or focus a row and press **`Shift + ↑ / ↓`**. The order in the Label Drawer controls the display order of labels everywhere — on cards, inside the Card Modal, and in the Filter Bar.
- **Smart duplicate prevention & Label Merge:**
  - Label names match loosely (ignoring case, spaces, and dashes). Creating `bug` when `Bug` already exists selects the existing label rather than creating a duplicate.
  - Renaming an existing label onto another label's name triggers a **Label Merge** confirmation dialog (irreversible): the target label survives and every card on the board (including archived cards) carrying the merged label is updated automatically.
- **Assign inside a card (`Cmd/Ctrl + G`):**
  - Assigned labels appear first with a checkmark (`✓`), followed by unassigned labels (if your board has many labels, click **+N more** to expand the rest). While hovering or navigating the row with the keyboard, chip positions stay frozen so chips never jump out from under your pointer.
  - Click the dashed **New label** chip to create and immediately assign a new label without leaving the card.

### Due Dates & Keyboard-First Picker

Click the **Due Date** chip (`Set due date` when empty) or press **`Cmd/Ctrl + U`** to open the popover picker.

**Consistent human-readable wording:**
- Within 7 days, dates display relatively (`Today`, `Tomorrow`, `in 3d`, `Overdue 3d`).
- Beyond a week, the calendar date takes over (`Nov 28`, `Overdue · Nov 2`; the year appears only when different from the current year) so you never have to do mental calendar math.
- Badges and chips are colour-coded by urgency (overdue, today, soon, future).

**Three fast ways to pick a date:**
1. **Type directly** (focused automatically when opened) and press **`Enter`**:
   - Exact ISO date: `2026-12-01`
   - Words (3+ letters): `today`, `tomorrow` (or `tod`, `tom`)
   - Weekday (3+ letters): `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` (picks the next occurrence after today)
   - Relative offset: `+3`, `+3d`, `+2w`, `-1d`
   - Leave empty and press `Enter` to clear the due date.
2. **Navigate the calendar grid** (press **`↓`** from the text field):
   - `←` `→` `↑` `↓`: Move by day or week
   - `PgUp` / `PgDn`: Previous / next month (`Shift + PgUp / PgDn` for year)
   - `Home` / `End`: Start / end of the week (respecting your locale's first day of the week)
   - `Enter` / `Space`: Pick the highlighted date
3. **Quick buttons:** Click **Today**, **Tomorrow**, **Next week**, or **Clear** (or click the `×` right on the due-date chip).

### Checklist

Cards can include a flat **Checklist** (`Cmd/Ctrl + L` expands it if hidden and focuses the *Add checklist item…* field; if you leave an empty checklist without typing anything, it quietly collapses again).

- **Add items:** Type an item and press `Enter` — focus stays in the input so you can add multiple items rapidly.
- **Keyboard navigation & actions on checklist items:**
  - `↑` / `↓`: Move focus between items
  - `Space`: Toggle checked / unchecked
  - `Enter`: Edit item text inline (`Enter` saves, `Esc` cancels)
  - `Shift + ↑ / ↓` (or mouse/touch drag): Reorder items
  - `Del` / `Backspace`: Remove item (asks inline `Delete? Yes / No`, with `Esc` cancelling back to the item)
- **Check all / Uncheck all** button and live `done/total` progress pill appear beside the input once items exist.
- Checklist changes save atomically with the card (`Cmd/Ctrl + S`).

### Attachments

Each card can hold file attachments up to **50 MB** per file.

- **How to attach files:**
  - Click **Attachment** (or **Add** tile) or press **`Cmd/Ctrl + O`**
  - Drag and drop one or more files anywhere onto the open **Card Modal** or **Notes Pane**
  - Paste an image from the clipboard
- **Images vs. general files:**
  - Image attachments automatically generate a JPEG thumbnail (up to 400 px), show an **`in text`** badge when embedded in the description, and open in a full-size **lightbox preview** on click or `Enter`.
  - Non-image files display their file extension badge (`PDF`, `ZIP`, `TXT`, etc.) and download when clicked or activated with `Enter`.
- **Hover / focus actions:** Insert image into description (`+`, for images) or delete (`×`, or `Del` / `Backspace` on a focused tile).
- Attachments save and delete immediately as standalone sidecar files and record their filename in the card's **History**.

### Card History & Diffs

Press **`Cmd/Ctrl + J`** (or click the clock/history button in the card footer) to inspect the card's version **History**:

- Automatically records up to the **last 100 saved content versions** of the card (title, labels, due date, description, checklist, and attachment filenames). Moving a card between lists, reordering it, or archiving it does not clutter history with no-op entries.
- Select versions on the left (newest at the top; navigate with `↑` / `↓`, `PgUp` / `PgDn` by 10, `Home` / `End`) to view a **field-by-field diff** on the right showing exactly what was added (`+`) or removed (`−`) in that version — including row-by-row diffs for tables and `[image: filename]` markers for inline images.
- History is read-only. Press `Cmd/Ctrl + J` or `Esc` to close.

### Archival PDF/A Export

Press **`Cmd/Ctrl + P`** (or click the **PDF** button in the card footer) to download a self-contained **PDF/A-2u** archive of the card, named automatically from the card's title.

- **What gets included:** Formatted title, board name and card creation timestamp (UTC), label chips, due date, full rich-text description (headings, formatted text, clickable links, nested lists, quotes, code blocks, tables & matrices with repeating headers, inline images), checklist (`☑` / `☐`), and remaining attachments (with thumbnails for non-inline images).
- **Clean pagination:** Sections, blocks up to half a page, and checklist/attachment groups are kept together where they fit, and paragraphs/tables split without leaving orphaned single lines or stranded table headers.
- **Unsaved edits prompt:** PDFs always render the *saved* card on disk. If you have unsaved changes when exporting, Synkban asks whether to **Save & export**, **Export saved version**, or **Cancel**.
- **Self-contained offline fonts:** Bundles DejaVu Sans, DejaVu Sans Mono, monochrome Noto Emoji, and Noto Sans Arabic, Hebrew, Devanagari, and Thai directly inside the app — zero reliance on system fonts or external browsers. *(To keep the app lightweight, CJK fonts are not bundled and appear as `?` in exported PDFs, though they display normally in the app.)*
- See **[PDF Export Examples](export-examples/README.md)** for visual reference sheets of every supported element and edge case.

---

## Filtering Cards

Press **`F`** (or click **Filter** in the top bar) to toggle the **Filter Bar** below the header.

All three filter controls combine with **AND** logic (every active condition must match):

1. **Text filter:** Case-insensitive substring search across card **titles**, **descriptions** (including table cell text), and **checklist items**.
2. **Due-date filter** (pick one; click again to clear):
   - **Overdue:** Cards due before today
   - **This week:** Cards due within the current calendar week (according to your browser locale)
   - **Until…:** Opens the **Due Date Picker** and shows cards due on or before the chosen day (including overdue)
   - *(Cards with no due date never match while a due-date filter is active.)*
3. **Label filter:** Click one or more label chips to require cards to carry **all** selected labels.

While filtering, list headers (and **List Tabs** in Notes Mode) display counts as **`matching/total`**. Press **`Esc`** inside the filter field once to clear active filters, and **`Esc`** again to close the bar.

---

## Archiving & Permanent Deletion

To protect against accidental data loss (especially across synced devices), Synkban uses a two-step lifecycle for boards and cards:

1. **Archive first:** Archiving hides a board or card from normal views while keeping its JSON files and attachments intact on disk.
2. **Restore or Delete permanently:** Open **Archived Boards** (`A` on the Board Overview) or **Archived Cards** (`A` inside a board) to browse archived items (newest archived first; navigate with `↑` / `↓`).
   - Click **Restore** to bring the item back immediately.
   - Click **Delete** → **Delete permanently? Yes / No** to erase the item (and all of its attachments) permanently from disk.

**Deleting a List & Orphaned Cards:**
- Lists cannot be archived directly. When you delete a list (confirmation required if non-empty), Synkban archives all cards inside it as **Orphaned Cards** before removing the list.
- Restoring a regular archived card returns it to its original list. Restoring an **Orphaned Card** from the **Archive Panel** places it into the first active list on the board (if the board currently has no lists, create a list first). In **Notes Mode**, clicking **Restore & save** on an open dirty card that was archived elsewhere restores it into the currently active list.

---

## Syncing, Backups, Crash Safety & Resilience

### Data Directory vs. Config Directory

Understanding the two folders Synkban uses makes syncing and backups effortless:

1. **Data Directory (sync this across devices):**
   Holds all boards, lists, cards, archived cards, and attachments under `boards/`:
   ```text
   <DATA_DIR>/
   └── boards/
       └── {board-id}/
           ├── board.json
           ├── lists/{list-id}/
           │   ├── list.json
           │   └── cards/{card-id}.json
           ├── archived_cards/{card-id}.json
           └── attachments/{card-id}/
               ├── {att-id}
               ├── {att-id}_thumb
               └── {att-id}.json
   ```
   **Resolution order** (highest priority wins):
   1. `--data-dir <path>` CLI flag
   2. `DATA_DIR` environment variable
   3. `data_dir` in `~/.config/synkban/synkban.toml`
   4. Default: `~/.config/synkban/data/` (`%USERPROFILE%\.config\synkban\data\` on Windows)

2. **Config Directory (keep local to each machine):**
   Default `~/.config/synkban/` (`%USERPROFILE%\.config\synkban\` on Windows, overridable via `SYNKBAN_CONFIG_DIR`). Contains:
   - `synkban.toml` — machine **Settings** (`data_dir`, `startup_view`, `last_board_id`, `theme`)
   - `draft.json` — the machine's local crash-recovery **Draft** for the open card

### Syncing Across Devices

Synkban works seamlessly with folder-sync tools such as **Syncthing**, **Dropbox**, **iCloud Drive**, **Nextcloud**, **Git**, or **rsync**:

1. Set up your sync folder (for example `~/Sync/synkban`) on each computer.
2. In Desktop Mode, open **Settings → Data folder → Browse…**, select your synced folder, and click **Save & Restart**. (In Web Mode, set `DATA_DIR` or `--data-dir`.)
3. If you already had boards in the default folder, **copy the `boards/` directory** into your synced folder manually — changing the folder in Settings never moves existing files automatically.

**Sync best practices:**
- **Sync only the Data Directory** — never sync `~/.config/synkban/` itself, because `draft.json` and `synkban.toml` are per-machine.
- **Keep Synkban versions aligned** across devices so newer features (such as tables, matrices, or inline images) render consistently everywhere.
- **No manual refresh needed:** Open boards and the Board Overview check for external file changes every **15 seconds** and reload updated boards automatically while keeping your cursor, open quick-add drafts, and card focus intact.
- **In-flight sync protection:** At startup, Synkban cleans up partial or orphaned attachment leftovers only if they are older than 5 minutes, avoiding interference with a sync still in progress.

### Backups & Migration

- **Back up:** Copy your **Data Directory** (`boards/`). Because everything is plain JSON and regular files, standard snapshots (Time Machine, Borg, restic, rsync, or ZIP archives) work without shutting Synkban down.
- **Migrate to a new machine:** Copy the Data Directory to the new machine and point Synkban at it via **Settings** (Desktop Mode) or `DATA_DIR` / `--data-dir` (Web Mode).

### Crash-Safe Drafts

Only one card can be open for editing at a time (in the **Card Modal** or **Notes Pane**). While it has unsaved changes:

- Synkban writes your unsaved content locally to `draft.json` in the Config Directory (~300 ms after typing, and again when closing/reloading the page).
- If the app crashes, closes unexpectedly, or reloads before you save, launching Synkban automatically navigates back to that board, reopens the card with your edits, and displays a banner: **`Restored your unsaved edits … Discard`**.
- **Conflict safety:** If the card was modified on disk in the meantime (e.g. synced from another device) or deleted, Synkban safely discards the stale draft instead of overwriting newer changes.
- Saving, clicking **Discard**, clicking **Revert**, or undoing back to the saved content clears the draft immediately.

### Data-Integrity Warnings & Offline Resilience

- **Data-integrity Warning Banner:** If Synkban encounters a corrupt or half-synced JSON file while reading your boards, it does **not** crash or wipe anything. It skips only the unreadable file, leaves it untouched on disk, keeps the rest of your workspace running, and displays a dismissible banner naming the exact file path so you can repair or finish syncing it.
- **Network Banner (Web / PWA Mode):** If the server temporarily restarts or your connection drops:
  - Already-loaded boards, lists, and open card edits stay on screen — Synkban never falsely shows *"Board not found"* or *"No boards yet"* during a network outage.
  - Failed quick-adds or label inputs restore your typed text instead of discarding it.
  - A non-blocking **Network Banner** with a **Retry** button appears and clears automatically once connectivity returns (re-syncing any open crash draft).

---

## Settings & Appearance

Click the **Settings** gear button in the top-right corner of the header on any page to configure:

- **Appearance:**
  - **Use system setting** (default) — follows your operating system's light or dark appearance live.
  - **Light** — always use the light theme.
  - **Dark** — always use the dark theme (adapts board backgrounds, card surfaces, sticky-note editor tint, and accent colours automatically).
  - Selecting an option previews the theme immediately; clicking **Cancel** or pressing `Esc` reverts it.
- **On startup, open:**
  - **Board overview** (default) — always starts on *Your Boards*.
  - **Last used board** — reopens the last board you visited (deep links to a specific board URL always take precedence, and if the last board was archived or deleted, Synkban falls back cleanly to the Board Overview).
- **Data folder:**
  - **Desktop Mode:** Displays the active folder path with **Browse…**, **Use default**, and **Save & Restart** (restarts the app onto the chosen folder; existing boards stay in the old folder).
  - **Web Mode:** Displays the active folder path and configuration precedence (`--data-dir`, `DATA_DIR`, or `synkban.toml`).

Power users can also edit `~/.config/synkban/synkban.toml` directly when Synkban is stopped:

```toml
data_dir = "/home/me/Sync/synkban"
startup_view = "last"      # "overview" (default) | "last"
theme = "system"           # "system" (default) | "light" | "dark"
last_board_id = "..."      # maintained automatically
```

---

## Keyboard Shortcuts Reference

Press **`?`** at any time outside text inputs to open the in-app **Keyboard shortcuts** dialog, which opens directly to the tab matching where your cursor or focus currently is (**Boards**, **Board**, **Notes**, **Card**, or **Editor** — switch tabs with `←` / `→` or `1`–`5`, and close with `?` or `Esc`).

### Boards Overview

| Shortcut | Action |
| --- | --- |
| `↑` `↓` `←` `→` | Move focus between boards |
| `Enter` | Open focused board |
| `N` | New board |
| `Shift + ↑ / ↓ / ← / →` | Reorder focused board |
| `Del` / `Backspace` | Archive focused board |
| `A` | Open / close Archived Boards |
| `Esc` | Close new-board form or Archive Panel |
| `?` | Open Keyboard shortcuts help |

### Board (Kanban Mode)

| Shortcut | Action |
| --- | --- |
| `↑` `↓` | Previous / next card in list (wraps) |
| `←` `→` | Move to neighbouring list (preserves vertical row) |
| `Home` / `PgUp` | First card of the list |
| `End` / `PgDn` | Last card of the list |
| `Enter` / `Space` / `E` | Open / edit focused card |
| `N` | Add card to focused list (`Enter` adds, `Esc` cancels) |
| `Del` / `Backspace` | Archive focused card |
| `C` | Collapse / expand focused list |
| `Enter` (on collapsed list) | Expand list |
| `R` / `F2` (or `Enter` on list title) | Rename list |
| `Shift + ↑` / `Shift + ↓` | Move card up / down (wraps) |
| `Shift + ←` / `Shift + →` | Move card to previous / next list |
| `Shift + Home` / `Shift + End` | Move card to top / bottom of list |
| `Shift + Alt + ←` / `Shift + Alt + →` | Move list left / right |

### Notes Mode Shortcuts

| Shortcut | Action |
| --- | --- |
| `↑` `↓` | Select card (shown beside the list) |
| `Home` / `End` | First / last card |
| `←` `→` | Previous / next List Tab |
| `Enter` / `E` | Edit the card's description |
| `Esc` | Return focus to the selected card from anywhere (asks if dirty) |
| `N` | Add card |
| `Shift + ↑` / `Shift + ↓` | Move card up / down |
| `Shift + ←` / `Shift + →` | Move card to previous / next list |
| `Shift + Alt + ←` / `Shift + Alt + →` | Move list (tab) left / right |
| `Drag` | Drop a card onto a List Tab to move it there |
| `Del` / `Backspace` | Archive card |
| `R` / `F2` (or `Enter` / click on active tab) | Rename list |
| `Cmd/Ctrl + S` | Save and keep editing |

### Whole Board & Panels (Both Modes)

| Shortcut | Action |
| --- | --- |
| `V` | Switch between Board (Kanban) and Notes view |
| `L` | Add list |
| `G` | Toggle Labels panel (**Label Drawer**) |
| `F` | Toggle **Filter Bar** |
| `A` | Open **Archived Cards** |
| `,` / `J` | Previous board |
| `.` / `K` | Next board |
| `B` | Back to all boards (Board Overview) |
| `?` | Keyboard shortcuts help |
| `Esc` (in Filter Bar) | Clear active filters first, then close the bar |
| `↑` `↓` (in Label Drawer / Archive Panel) | Move between items |
| `Shift + ↑` / `Shift + ↓` (in Label Drawer) | Reorder labels |
| `Enter` (in Label Drawer) | Rename label (renaming onto another label merges after confirmation) |
| `Esc` | Close open panel / cancel rename |

### Card Modal & Notes Pane

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + S` | Save card |
| `Esc` | Close modal / leave Notes Pane (asks about unsaved edits) |
| `Cmd/Ctrl + J` | Open / close Card **History** |
| `Cmd/Ctrl + P` | Export card as **PDF/A** |
| `Cmd/Ctrl + E` | Focus **Title** (`Enter` jumps to Description) |
| `Cmd/Ctrl + U` | Open **Due Date** picker |
| `Cmd/Ctrl + G` | Focus **Labels** row |
| `Cmd/Ctrl + D` | Focus **Description** editor |
| `Cmd/Ctrl + L` | Focus / expand **Checklist** add field |
| `Cmd/Ctrl + O` | Add **Attachment** |
| `Cmd/Ctrl + B` / `Cmd/Ctrl + I` (in title/label input) | Wrap selection in `**bold**` / `*italic*` |
| `?` (outside text fields) | Keyboard shortcuts help |

#### Due Date Picker, Checklist, Attachments & History

| Context | Shortcut | Action |
| --- | --- | --- |
| **Due Date Picker** | `2026-12-01`, `tomorrow`, `fri`, `+3d` + `Enter` | Parse typed date and apply (empty clears) |
| **Due Date Picker** | `↓` (from field) | Enter calendar grid |
| **Due Date Picker** | `←` `→` `↑` `↓` | Move by day / week |
| **Due Date Picker** | `PgUp` / `PgDn` (`Shift`: year) | Previous / next month (or year) |
| **Due Date Picker** | `Home` / `End` | Start / end of the week |
| **Due Date Picker** | `Enter` / `Space` / `Esc` | Pick day / close picker |
| **Checklist** | `↑` `↓` | Previous / next checklist item |
| **Checklist** | `Space` | Check / uncheck item |
| **Checklist** | `Enter` (on item) | Edit item (`Enter` saves, `Esc` cancels) |
| **Checklist** | `Enter` (in *Add item*) | Add item and stay for the next |
| **Checklist** | `Shift + ↑` / `Shift + ↓` | Reorder item |
| **Checklist** | `Del` / `Backspace` | Delete item (asks inline) |
| **Attachments** | `Enter` (on tile) | Preview image / download file |
| **Attachments** | `Del` / `Backspace` (on tile) | Remove attachment |
| **History** | `↑` `↓` | Newer / older version |
| **History** | `PgUp` / `PgDn` | Jump 10 versions |
| **History** | `Home` / `End` | Current / oldest version |

### Rich-Text Editor

| Context | Shortcut | Action |
| --- | --- | --- |
| **Text** | `Cmd/Ctrl + B` | Bold |
| **Text** | `Cmd/Ctrl + I` | Italic |
| **Text** | ``Cmd/Ctrl + ` `` | Inline code |
| **Text** | `Cmd/Ctrl + Z` | Undo |
| **Text** | `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y` | Redo |
| **Text** | `Shift + Enter` or `Cmd/Ctrl + Enter` | Line break |
| **Text** | `Cmd/Ctrl + K` or `Right-click` | Open **Editor Menu** |
| **Text** | `Esc` | Close menu, else leave card |
| **Text styles** | `Ctrl + Shift + 0` | Plain text |
| **Text styles** | `Ctrl + Shift + 1 / 2 / 3` | Heading 1–3 |
| **Text styles** | `Ctrl + Shift + \` | Code block |
| **Text styles** | `Ctrl + >` | Quote |
| **Text styles** | `Alt + ↑` / `Alt + ↓` | Join with block above / below |
| **While typing** | `# `, `## `, `### ` | Heading 1–3 (at line start) |
| **While typing** | `- ` or `* ` | Bulleted list (at line start) |
| **While typing** | `1. ` | Numbered list (at line start) |
| **While typing** | `> ` | Quote (at line start) |
| **While typing** | ```` ``` ```` | Code block (at line start) |
| **While typing** | `Backspace` right after | Undo auto-formatting |
| **Lists** | `Tab` or `Cmd/Ctrl + ]` | Nest item |
| **Lists** | `Shift + Tab` or `Cmd/Ctrl + [` | Outdent item |
| **Lists** | `Enter` | New item (empty item exits list) |
| **Lists** | `Ctrl + Shift + 8` / `9` | Bulleted / numbered list |
| **In Editor Menu** | `↑` `↓` `Home` `End` + `Enter` | Highlight and run item |
| **In Editor Menu** | `L` / `U` | Add or edit link / remove link |
| **In Editor Menu** | `I` / `M` | Inline code / insert image |
| **In Editor Menu** | `0` / `B` / `1` `2` `3` | Plain text / code block / Heading 1–3 |
| **In Editor Menu** | `T` / `X` | Insert table / insert matrix |
| **In Image Picker** | `1`–`9` / `U` / `↑` `↓` + `Enter` | Insert existing image / upload new image |
| **Tables & Matrices** | `Tab` / `Shift + Tab` | Next / previous cell (last cell adds row) |
| **Tables & Matrices** | `Enter` | Next row (last row exits table) |
| **Tables & Matrices** | `Shift + Enter` | Line break inside cell |
| **Tables & Matrices (Menu)** | `W` `S` `A` `D` | Move row up/down or column left/right |
| **Tables & Matrices (Menu)** | `X` | Transpose matrix |
| **Tables & Matrices (Menu)** | `Shift + ↑↓←→` | Insert row / column |
| **Tables & Matrices (Menu)** | `1` `2` `3` | Align column (matrix: cell) left / centre / right |
| **Tables & Matrices (Menu)** | `R` / `C` / `T` | Delete row / column / table or matrix |

---

## Troubleshooting & FAQ

### macOS says `"Synkban.app" is damaged and can't be opened`
Release builds are currently unsigned. Clear the quarantine flag in Terminal and reopen the app:
```bash
sudo xattr -cr /Applications/Synkban.app
```

### I changed the Data folder in Settings and my existing boards disappeared
Changing the **Data folder** points Synkban at the new folder without moving files automatically. Copy your existing `boards/` folder from the old Data Directory (by default `~/.config/synkban/data/boards/` on macOS/Linux or `%USERPROFILE%\.config\synkban\data\boards\` on Windows) into the new folder and Synkban will pick them up on the next refresh or restart.

### Why does Synkban have a Save button on cards instead of autosaving every keystroke?
Syncing one JSON file per card across Dropbox, Syncthing, or Git works best when edits are written cleanly in one atomic step rather than mid-word every few milliseconds — and saving deliberately gives you meaningful **Card History** snapshots. Meanwhile, machine-local crash drafts (`draft.json`) ensure you still never lose unsaved typing if the app closes or reloads unexpectedly.

### A yellow warning banner says a file could not be read and was skipped — is my data lost?
No. Synkban leaves skipped files untouched on disk so other boards and cards stay usable. This usually happens if a sync tool is mid-transfer or if a JSON file was edited manually with invalid syntax. Let your sync finish (or fix the syntax in the file path listed in the banner) and Synkban will pick it up on the next refresh.

### I accidentally deleted a list — are its cards gone?
No. Deleting a list automatically archives all cards that were inside it as **Orphaned Cards**. Press **`A`** on the board to open **Archived Cards** and click **Restore** to bring them back into the board's first list.

### How can I use Synkban on my phone or tablet?
Run Synkban in Docker behind an HTTPS reverse proxy (such as the [Traefik + Tinyauth PWA setup](docker/README.md)), sign in once, and install it to your Home Screen. Touch screens support scrolling, tapping, and **long-press drag-and-drop** for reordering cards, lists, boards, labels, and checklist items.

### Why do Chinese, Japanese, or Korean (CJK) characters appear as `?` in exported PDFs?
To keep the offline single binary and PDF export engine compact, CJK font files (10–18 MB each) are not bundled inside the binary, and the PDF/A standard requires replacing missing glyphs with `?`. Inside the Synkban app itself, CJK text displays normally using your system fonts.
