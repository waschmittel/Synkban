import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "..", "docs", "images");

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface PmMark {
  type: "strong" | "em" | "code" | "link";
  attrs?: Record<string, unknown>;
}

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

const txt = (text: string, marks?: PmMark[]): PmNode =>
  marks?.length ? { type: "text", text, marks } : { type: "text", text };

const bold = (text: string): PmNode => txt(text, [{ type: "strong" }]);
const italic = (text: string): PmNode => txt(text, [{ type: "em" }]);
const code = (text: string): PmNode => txt(text, [{ type: "code" }]);
const link = (text: string, href: string): PmNode =>
  txt(text, [{ type: "link", attrs: { href, title: null } }]);

const para = (...content: PmNode[]): PmNode => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});

const heading = (level: 1 | 2 | 3, ...content: PmNode[]): PmNode => ({
  type: "heading",
  attrs: { level },
  content,
});

const blockquote = (...blocks: PmNode[]): PmNode => ({
  type: "blockquote",
  content: blocks,
});

const codeBlock = (body: string): PmNode => ({
  type: "code_block",
  content: [txt(body)],
});

const bulletList = (...items: PmNode[][]): PmNode => ({
  type: "bullet_list",
  content: items.map((blocks) => ({ type: "list_item", content: blocks })),
});

const pmImage = (att: string, alt: string): PmNode => ({
  type: "image",
  attrs: { att, alt },
});

type Align = "left" | "center" | "right" | null;

const th = (text: string): PmNode => ({
  type: "table_header",
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
  content: text ? [para(txt(text))] : [para()],
});

const thCol = (text: string, align: Align = null): PmNode => ({
  type: "table_header",
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align },
  content: text ? [para(txt(text))] : [para()],
});

const td = (text: string, align: Align = null): PmNode => ({
  type: "table_cell",
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align },
  content: text ? [para(txt(text))] : [para()],
});

function makeTable(headers: { text: string; align?: Align }[], rows: string[][]): PmNode {
  return {
    type: "table",
    attrs: { matrix: false },
    content: [
      {
        type: "table_row",
        content: headers.map((h) => thCol(h.text, h.align ?? null)),
      },
      ...rows.map((r) => ({
        type: "table_row",
        content: r.map((cell, i) => td(cell, headers[i]?.align ?? null)),
      })),
    ],
  };
}

function makeMatrix(
  colHeaders: string[],
  rows: { header: string; cells: { text: string; align?: Align }[] }[],
): PmNode {
  return {
    type: "table",
    attrs: { matrix: true },
    content: [
      {
        type: "table_row",
        content: [td("", null), ...colHeaders.map((h) => th(h))],
      },
      ...rows.map((r) => ({
        type: "table_row",
        content: [th(r.header), ...r.cells.map((c) => td(c.text, c.align ?? null))],
      })),
    ],
  };
}

const doc = (...blocks: PmNode[]): string => JSON.stringify({ type: "doc", content: blocks });

async function settleUi(page: Page, extraMs = 350) {
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
    const imgs = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) =>
        img.complete ? Promise.resolve() : new Promise((r) => {
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        }),
      ),
    );
    await Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    );
  });
  await page.waitForTimeout(extraMs);
}

async function generateGraphicFixtures(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 480 },
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();

  // 1. Sync architecture diagram
  await p.setContent(`
    <!doctype html>
    <html>
      <body style="margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:inline-block;">
        <div id="graphic" style="width:680px;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;padding:20px 24px;box-sizing:border-box;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0f766e;margin-bottom:14px;">
            Local-First File Sync Architecture
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="flex:1;background:#f0fdfa;border:1.5px solid #99f6e4;border-radius:10px;padding:12px 14px;">
              <div style="font-size:13px;font-weight:700;color:#115e59;">Synkban App</div>
              <div style="font-size:11px;color:#475569;margin-top:4px;line-height:1.4;">Desktop or Web UI<br/>Atomic writes · 15s poll</div>
            </div>
            <div style="font-size:18px;font-weight:700;color:#64748b;">⇄</div>
            <div style="flex:1.15;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:10px;padding:12px 14px;">
              <div style="font-size:13px;font-weight:700;color:#3730a3;">boards/ Data Folder</div>
              <div style="font-size:11px;color:#475569;margin-top:4px;line-height:1.4;font-family:ui-monospace,SFMono-Regular,monospace;">
                board.json · list.json<br/>cards/*.json · attachments/
              </div>
            </div>
            <div style="font-size:18px;font-weight:700;color:#64748b;">⇄</div>
            <div style="flex:1;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:12px 14px;">
              <div style="font-size:13px;font-weight:700;color:#9a3412;">Your Sync Tool</div>
              <div style="font-size:11px;color:#475569;margin-top:4px;line-height:1.4;">Syncthing · Dropbox<br/>iCloud · Nextcloud · Git</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
  const syncFlowPng = await p.locator("#graphic").screenshot();

  // 2. Wireframe preview graphic for Product Launch card
  await p.setContent(`
    <!doctype html>
    <html>
      <body style="margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:inline-block;">
        <div id="wireframe" style="width:520px;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;box-sizing:border-box;">
          <div style="background:#4f46e5;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:12px;font-weight:700;letter-spacing:0.03em;">Synkban</span>
            <span style="font-size:11px;opacity:0.85;">Docs · Download · GitHub</span>
          </div>
          <div style="padding:20px 22px;display:flex;gap:18px;align-items:center;">
            <div style="flex:1.1;">
              <div style="display:inline-block;background:#eef2ff;color:#4338ca;font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;margin-bottom:8px;">
                LOCAL-FIRST KANBAN &amp; NOTES
              </div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.25;">
                Your boards as plain files.
              </div>
              <div style="font-size:11px;color:#64748b;margin-top:6px;line-height:1.45;">
                Sync with Syncthing or Dropbox. Export archival PDFs offline.
              </div>
              <div style="margin-top:12px;display:flex;gap:8px;">
                <span style="background:#4f46e5;color:#fff;font-size:11px;font-weight:600;padding:5px 11px;border-radius:6px;">Download App</span>
                <span style="border:1px solid #cbd5e1;color:#334155;font-size:11px;font-weight:600;padding:5px 11px;border-radius:6px;">User Guide</span>
              </div>
            </div>
            <div style="flex:0.9;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
              <div style="background:#fff;border-radius:4px;padding:6px;height:74px;border:1px solid #e2e8f0;">
                <div style="height:6px;width:70%;background:#94a3b8;border-radius:2px;margin-bottom:6px;"></div>
                <div style="height:18px;background:#eef2ff;border-radius:3px;margin-bottom:5px;"></div>
                <div style="height:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;"></div>
              </div>
              <div style="background:#fff;border-radius:4px;padding:6px;height:74px;border:1px solid #e2e8f0;">
                <div style="height:6px;width:80%;background:#94a3b8;border-radius:2px;margin-bottom:6px;"></div>
                <div style="height:22px;background:#fef3c7;border-radius:3px;margin-bottom:5px;"></div>
                <div style="height:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;"></div>
              </div>
              <div style="background:#fff;border-radius:4px;padding:6px;height:74px;border:1px solid #e2e8f0;">
                <div style="height:6px;width:60%;background:#94a3b8;border-radius:2px;margin-bottom:6px;"></div>
                <div style="height:16px;background:#dcfce7;border-radius:3px;"></div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
  const wireframePng = await p.locator("#wireframe").screenshot();

  await ctx.close();
  return { syncFlowPng, wireframePng };
}

async function apiJson<T>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(path, {
    method,
    ...(data !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify(data),
        }
      : {}),
  });
  if (!res.ok()) {
    throw new Error(`${method} ${path} failed (${res.status()}): ${await res.text()}`);
  }
  if (res.status() === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function uploadAttachment(
  request: APIRequestContext,
  cardId: string,
  filename: string,
  contentType: string,
  data: Buffer,
) {
  const res = await request.post(
    `/api/cards/${cardId}/attachments?filename=${encodeURIComponent(filename)}`,
    {
      headers: { "Content-Type": contentType },
      data,
    },
  );
  if (!res.ok()) {
    throw new Error(`Upload ${filename} failed (${res.status()}): ${await res.text()}`);
  }
  return res.json() as Promise<{ id: string; filename: string }>;
}

function paddedBox(
  box: { x: number; y: number; width: number; height: number },
  pad: number | { top?: number; right?: number; bottom?: number; left?: number },
  vw = 1240,
  vh = 840,
) {
  const p =
    typeof pad === "number"
      ? { top: pad, right: pad, bottom: pad, left: pad }
      : { top: pad.top ?? 16, right: pad.right ?? 16, bottom: pad.bottom ?? 16, left: pad.left ?? 16 };
  const x = Math.max(0, Math.floor(box.x - p.left));
  const y = Math.max(0, Math.floor(box.y - p.top));
  const right = Math.min(vw, Math.ceil(box.x + box.width + p.right));
  const bottom = Math.min(vh, Math.ceil(box.y + box.height + p.bottom));
  return { x, y, width: right - x, height: bottom - y };
}

test("generate user-guide screenshots", async ({ page, browser, request }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  const { syncFlowPng, wireframePng } = await generateGraphicFixtures(browser);
  const samplePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

  // Ensure deterministic light starting theme & overview startup.
  await apiJson(request, "PUT", "/api/settings", {
    theme: "light",
    startup_view: "overview",
  });

  // --- Board 1: Product Launch (Kanban Mode) ---
  const launch = await apiJson<{ id: string }>(request, "POST", "/api/boards", {
    title: "Product Launch",
  });
  await apiJson(request, "PUT", `/api/boards/${launch.id}`, {
    color: "#4f46e5",
    mode: "kanban",
  });

  const lblPriority = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/labels`, { name: "Priority" });
  const lblDesign = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/labels`, { name: "Design" });
  const lblBackend = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/labels`, { name: "Backend" });
  const lblDocs = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/labels`, { name: "Docs" });
  const lblRelease = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/labels`, { name: "**Release**" });
  await apiJson(request, "PUT", `/api/boards/${launch.id}/labels/order`, {
    ids: [lblPriority.id, lblDesign.id, lblBackend.id, lblDocs.id, lblRelease.id],
  });

  const listBacklog = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/lists`, { title: "Backlog" });
  const listInProgress = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/lists`, { title: "In Progress" });
  const listReview = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/lists`, { title: "Review" });
  const listDone = await apiJson<{ id: string }>(request, "POST", `/api/boards/${launch.id}/lists`, { title: "Done" });
  await apiJson(request, "PUT", `/api/lists/${listDone.id}`, { collapsed: true });

  // Backlog cards
  await apiJson(request, "POST", `/api/lists/${listBacklog.id}/cards`, {
    title: "Write migration notes for **v2.0**",
    label_ids: [lblDocs.id, lblRelease.id],
    due_date: isoDaysFromNow(14),
  });
  const cBench = await apiJson<{ id: string }>(request, "POST", `/api/lists/${listBacklog.id}/cards`, {
    title: "Benchmark PDF export memory usage",
    label_ids: [lblBackend.id],
  });
  await apiJson(request, "PUT", `/api/cards/${cBench.id}`, {
    description: doc(para(txt("Verify large tables stay under target latency during export."))),
  });
  await apiJson(request, "POST", `/api/lists/${listBacklog.id}/cards`, {
    title: "Update Homebrew tap formula",
    label_ids: [lblPriority.id, lblRelease.id],
    due_date: isoDaysFromNow(0),
  });

  // In Progress cards (hero card: Design landing page)
  const heroLanding = await apiJson<{ id: string }>(request, "POST", `/api/lists/${listInProgress.id}/cards`, {
    title: "Landing page v1 draft",
    label_ids: [lblDesign.id],
    due_date: isoDaysFromNow(5),
  });
  const attWireframe = await uploadAttachment(request, heroLanding.id, "landing-wireframe.png", "image/png", wireframePng);
  await uploadAttachment(request, heroLanding.id, "sync-diagram.png", "image/png", syncFlowPng);
  await uploadAttachment(request, heroLanding.id, "q4-launch-plan.pdf", "application/pdf", samplePdf);

  // Version 2
  await apiJson(request, "PUT", `/api/cards/${heroLanding.id}`, {
    title: "Landing page redesign",
    label_ids: [lblPriority.id, lblDesign.id],
    due_date: isoDaysFromNow(3),
    description: doc(
      heading(2, txt("Hero & Social Proof")),
      para(
        txt("Keep the hero focused on "),
        bold("local-first file ownership"),
        txt(" and add a live product preview."),
      ),
      para(pmImage(attWireframe.id, "landing-wireframe.png")),
    ),
    checklist: [
      { id: "cl-1", text: "Header navigation & download CTA", done: true },
      { id: "cl-2", text: "Syncing workflow comparison block", done: false },
      { id: "cl-3", text: "Mobile breakpoint review", done: false },
    ],
  });

  // Version 3 (current)
  await apiJson(request, "PUT", `/api/cards/${heroLanding.id}`, {
    title: "Design landing page",
    label_ids: [lblPriority.id, lblDesign.id, lblRelease.id],
    due_date: isoDaysFromNow(0),
    description: doc(
      heading(2, txt("Hero & Social Proof")),
      para(
        txt("Focus the hero on "),
        bold("plain-file ownership"),
        txt(", cross-platform shortcuts, and a "),
        link("live user guide", "https://example.com/guide"),
        txt("."),
      ),
      para(pmImage(attWireframe.id, "landing-wireframe.png")),
      makeTable(
        [
          { text: "Section", align: "left" },
          { text: "Owner", align: "left" },
          { text: "Status", align: "right" },
        ],
        [
          ["Hero & CTA", "Elena", "Ready"],
          ["Sync overview", "Marco", "In review"],
        ],
      ),
    ),
    checklist: [
      { id: "cl-1", text: "Header navigation & download CTA", done: true },
      { id: "cl-2", text: "Syncing workflow comparison block", done: true },
      { id: "cl-3", text: "Mobile breakpoint review", done: false },
      { id: "cl-4", text: "Publish OpenGraph preview image", done: false },
    ],
  });

  const cSyncDocs = await apiJson<{ id: string }>(request, "POST", `/api/lists/${listInProgress.id}/cards`, {
    title: "Publish Syncthing setup checklist",
    label_ids: [lblDocs.id],
    due_date: isoDaysFromNow(1),
  });
  await apiJson(request, "PUT", `/api/cards/${cSyncDocs.id}`, {
    checklist: [
      { id: "s-1", text: "Verify .config folder exclusion", done: true },
      { id: "s-2", text: "Document conflict behaviour", done: true },
      { id: "s-3", text: "Add backup command examples", done: true },
    ],
  });

  await apiJson(request, "POST", `/api/lists/${listInProgress.id}/cards`, {
    title: "Verify Windows NSIS installer icon",
    label_ids: [lblBackend.id, lblRelease.id],
    due_date: isoDaysFromNow(3),
  });

  // Review cards
  await apiJson(request, "POST", `/api/lists/${listReview.id}/cards`, {
    title: "Audit keyboard shortcuts on Linux",
    label_ids: [lblPriority.id],
    due_date: isoDaysFromNow(0),
  });
  const cPress = await apiJson<{ id: string }>(request, "POST", `/api/lists/${listReview.id}/cards`, {
    title: "Prepare release announcement",
    label_ids: [lblDocs.id, lblDesign.id],
    due_date: isoDaysFromNow(2),
  });
  await apiJson(request, "PUT", `/api/cards/${cPress.id}`, {
    description: doc(para(txt("Highlight Notes mode, quick-add syntax, and PDF/A-2u archival export."))),
    checklist: [
      { id: "p-1", text: "Draft changelog highlights", done: true },
      { id: "p-2", text: "Record fresh demo clip", done: false },
    ],
  });

  // Done cards (collapsed list)
  for (const title of [
    "Tag multi-arch Docker image",
    "Add dark mode colour clamping",
    "Set up automated Playwright suite",
  ]) {
    await apiJson(request, "POST", `/api/lists/${listDone.id}/cards`, { title });
  }

  // Archived cards on Product Launch
  for (const title of [
    "Legacy OAuth login spike",
    "Old pricing table draft",
    "Early beta FAQ scratchpad",
  ]) {
    const ac = await apiJson<{ id: string }>(request, "POST", `/api/lists/${listBacklog.id}/cards`, { title });
    await apiJson(request, "PUT", `/api/cards/${ac.id}`, { archived: true });
  }

  // --- Board 2: Architecture Notes (Notes Mode) ---
  const archBoard = await apiJson<{ id: string }>(request, "POST", "/api/boards", {
    title: "Architecture Notes",
  });
  await apiJson(request, "PUT", `/api/boards/${archBoard.id}`, {
    color: "#0f766e",
    mode: "notes",
  });
  const lblArch = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/labels`, { name: "Architecture" });
  const lblSync = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/labels`, { name: "Sync" });
  const lblDec = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/labels`, { name: "Decision" });

  const tabDesign = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/lists`, { title: "Design Docs" });
  const tabMeeting = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/lists`, { title: "Meeting Notes" });
  const tabDecisions = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/lists`, { title: "Decisions" });
  const tabRef = await apiJson<{ id: string }>(request, "POST", `/api/boards/${archBoard.id}/lists`, { title: "Reference" });

  const syncCard = await apiJson<{ id: string }>(request, "POST", `/api/lists/${tabDesign.id}/cards`, {
    title: "Sync & Storage Architecture",
    label_ids: [lblArch.id, lblSync.id],
    due_date: isoDaysFromNow(5),
  });
  const attSyncDiagram = await uploadAttachment(request, syncCard.id, "sync-architecture.png", "image/png", syncFlowPng);
  await uploadAttachment(request, syncCard.id, "storage-spec.pdf", "application/pdf", samplePdf);

  await apiJson(request, "PUT", `/api/cards/${syncCard.id}`, {
    description: doc(
      heading(1, txt("Local-First Storage Overview")),
      para(
        txt("Each board lives in its own folder inside "),
        code("DATA_DIR"),
        txt(" using "),
        bold("atomic temp-file renames"),
        txt(" and "),
        italic("sidecar attachments"),
        txt(". See the "),
        link("Synkban Guide", "https://example.com/synkban"),
        txt(" for sync setup."),
      ),
      para(pmImage(attSyncDiagram.id, "sync-architecture.png")),
      heading(2, txt("Sync Guarantees")),
      bulletList(
        [para(bold("Per-card JSON files:"), txt(" concurrent edits on different cards never conflict."))],
        [
          para(bold("Sidecar attachments:"), txt(" binaries and thumbnails live beside card JSON.")),
          bulletList(
            [para(txt("5-minute startup grace window protects in-flight syncs."))],
          ),
        ],
      ),
      blockquote(para(txt("Keep machine settings and crash drafts outside the synced folder."))),
      makeTable(
        [
          { text: "Layer", align: "left" },
          { text: "Format", align: "left" },
          { text: "Synced?", align: "center" },
        ],
        [
          ["Boards & Lists", "board.json / list.json", "Yes"],
          ["Cards", "{card-id}.json", "Yes"],
          ["Settings & Draft", "synkban.toml / draft.json", "No"],
        ],
      ),
      codeBlock("HOST=127.0.0.1 PORT=8080 DATA_DIR=~/Sync/synkban ./synkban"),
    ),
    checklist: [
      { id: "n-1", text: "Verify atomic write-and-rename on Windows", done: true },
      { id: "n-2", text: "Benchmark 15s directory mtime polling", done: true },
      { id: "n-3", text: "Document backup workflow", done: false },
    ],
  });

  const matrixCard = await apiJson<{ id: string }>(request, "POST", `/api/lists/${tabDesign.id}/cards`, {
    title: "Platform Support Matrix",
    label_ids: [lblArch.id, lblDec.id],
  });
  await apiJson(request, "PUT", `/api/cards/${matrixCard.id}`, {
    description: doc(
      para(
        txt("Release deliverables and configuration defaults across operating systems ("),
        code("Transpose"),
        txt(" swaps rows and columns in one step):"),
      ),
      makeMatrix(
        ["macOS", "Linux", "Windows"],
        [
          {
            header: "Desktop App",
            cells: [
              { text: "DMG / ZIP", align: "center" },
              { text: "AppImage / DEB", align: "center" },
              { text: "NSIS .exe", align: "center" },
            ],
          },
          {
            header: "Web Binary",
            cells: [
              { text: "arm64 native", align: "left" },
              { text: "x64 / arm64", align: "left" },
              { text: "synkban.exe", align: "left" },
            ],
          },
          {
            header: "Config Path",
            cells: [
              { text: "~/.config/synkban", align: "right" },
              { text: "~/.config/synkban", align: "right" },
              { text: "%USERPROFILE%\\.config", align: "right" },
            ],
          },
        ],
      ),
    ),
  });

  await apiJson(request, "POST", `/api/lists/${tabDesign.id}/cards`, {
    title: "PDF/A-2u Font Embedding Notes",
    label_ids: [lblArch.id],
  });
  await apiJson(request, "POST", `/api/lists/${tabDesign.id}/cards`, {
    title: "Keyboard Focus & Overlay Rules",
    label_ids: [lblDec.id],
  });

  for (const t of ["Weekly Sync Review — Nov 14", "Offline Mobile Test Notes", "Q4 Roadmap Kickoff"]) {
    await apiJson(request, "POST", `/api/lists/${tabMeeting.id}/cards`, { title: t });
  }
  for (const t of ["Use Fractional Card Positions", "Archive Before Permanent Delete"]) {
    await apiJson(request, "POST", `/api/lists/${tabDecisions.id}/cards`, { title: t, label_ids: [lblDec.id] });
  }
  for (const t of ["Traefik + Tinyauth PWA Config", "Shortcut Key Map"]) {
    await apiJson(request, "POST", `/api/lists/${tabRef.id}/cards`, { title: t });
  }

  // --- Board 3: Personal (shows overdue count on Overview) ---
  const personal = await apiJson<{ id: string }>(request, "POST", "/api/boards", { title: "Personal" });
  await apiJson(request, "PUT", `/api/boards/${personal.id}`, { color: "#d97706" });
  const pList = await apiJson<{ id: string }>(request, "POST", `/api/boards/${personal.id}/lists`, { title: "Errands" });
  await apiJson(request, "POST", `/api/lists/${pList.id}/cards`, { title: "Renew passport", due_date: isoDaysFromNow(-2) });
  await apiJson(request, "POST", `/api/lists/${pList.id}/cards`, { title: "Book dentist appointment", due_date: isoDaysFromNow(4) });
  await apiJson(request, "POST", `/api/lists/${pList.id}/cards`, { title: "Order coffee beans" });
  await apiJson(request, "POST", `/api/lists/${pList.id}/cards`, { title: "Back up photo library" });

  // --- Board 4: Home Renovation ---
  const homeBoard = await apiJson<{ id: string }>(request, "POST", "/api/boards", { title: "Home Renovation" });
  await apiJson(request, "PUT", `/api/boards/${homeBoard.id}`, { color: "#0079bf" });
  const hList = await apiJson<{ id: string }>(request, "POST", `/api/boards/${homeBoard.id}/lists`, { title: "Kitchen" });
  await apiJson(request, "POST", `/api/lists/${hList.id}/cards`, { title: "Measure counter depth" });
  await apiJson(request, "POST", `/api/lists/${hList.id}/cards`, { title: "Compare induction cooktops" });
  await apiJson(request, "POST", `/api/lists/${hList.id}/cards`, { title: "Pick tile grout colour" });

  // --- Archived Board ---
  const oldBoard = await apiJson<{ id: string }>(request, "POST", "/api/boards", { title: "Q2 Retrospective" });
  await apiJson(request, "PUT", `/api/boards/${oldBoard.id}`, { archived: true });

  // Order active boards nicely
  await apiJson(request, "PUT", "/api/boards/order", {
    ids: [launch.id, archBoard.id, personal.id, homeBoard.id],
  });

  // =====================================================================
  // CAPTURE SCREENSHOTS
  // =====================================================================

  // 1. board-overview.png
  await page.goto("/");
  await expect(page.locator("a.board-card")).toHaveCount(4);
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "board-overview.png") });

  // 2. settings.png (opened from overview)
  await page.locator(".btn-header-settings").click();
  await expect(page.locator(".settings-dialog")).toBeVisible();
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "settings.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-overlay")).toHaveCount(0);

  // 3. kanban-mode.png
  await page.goto(`/board/${launch.id}`);
  await expect(page.locator(".list")).toHaveCount(4);
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "kanban-mode.png") });

  // 4. quick-add.png (crop around Backlog list with live preview chips)
  const backlogList = page.locator(".list").first();
  await backlogList.locator(".add-trigger").click();
  const quickInput = backlogList.locator(".add-form input");
  await expect(quickInput).toBeFocused();
  await quickInput.fill("Release notes #docs #v2-launch due:fri");
  await expect(backlogList.locator(".quick-add-preview")).toBeVisible();
  await settleUi(page, 250);
  const backlogBox = (await backlogList.boundingBox())!;
  await page.screenshot({
    path: join(OUT_DIR, "quick-add.png"),
    clip: paddedBox(backlogBox, 18),
  });
  await page.keyboard.press("Escape");
  await expect(backlogList.locator(".add-form")).toHaveCount(0);

  // 5. label-drawer.png
  await page.keyboard.press("g");
  await expect(page.locator(".label-drawer--open")).toBeVisible();
  await settleUi(page, 450);
  await page.screenshot({ path: join(OUT_DIR, "label-drawer.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".label-drawer--open")).toHaveCount(0);

  // 6. filter-bar.png (This week + Priority so cards remain visible across lists)
  await page.keyboard.press("f");
  await expect(page.locator(".filter-bar")).toBeVisible();
  await page.locator(".filter-due-chip", { hasText: "This week" }).click();
  await page.locator(".filter-label-chip", { hasText: "Priority" }).click();
  await expect(page.locator(".card")).toHaveCount(3);
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "filter-bar.png") });
  await page.locator(".filter-input-clear").click();
  await page.locator(".board-filter-btn").click();
  await expect(page.locator(".filter-bar")).toHaveCount(0);
  await page.locator(".board-page").evaluate((el) => (el as HTMLElement).focus());

  // 7. archive-panel.png (with one inline Delete permanently? Yes/No shown)
  await page.keyboard.press("a");
  await expect(page.locator(".archive-modal")).toBeVisible();
  await expect(page.locator(".archive-card-item")).toHaveCount(3);
  await page.locator(".archive-card-item").nth(1).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".archive-confirm-text")).toBeVisible();
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "archive-panel.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".archive-modal-overlay")).toHaveCount(0);

  // 8. shortcut-help.png
  await page.locator(".board-page").evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("?");
  await expect(page.locator(".shortcut-help-modal")).toBeVisible();
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "shortcut-help.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".shortcut-help-overlay")).toHaveCount(0);

  // 9. card-modal-editor-menu.png
  await page.locator(".card", { hasText: "Design" }).first().click();
  await expect(page.locator(".modal-content")).toBeVisible();
  await settleUi(page);
  const firstPara = page.locator(".modal-content .ProseMirror p").first();
  await firstPara.click();
  await page.waitForTimeout(100);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await settleUi(page, 250);
  await page.screenshot({ path: join(OUT_DIR, "card-modal-editor-menu.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".table-menu")).toHaveCount(0);

  // 10. due-date-picker.png
  await page.locator(".modal-content .due-chip").click();
  await expect(page.locator(".due-picker")).toBeVisible();
  await settleUi(page, 250);
  const modalBox = (await page.locator(".modal-content").boundingBox())!;
  const pickerBox = (await page.locator(".due-picker").boundingBox())!;
  const combinedDueBox = {
    x: Math.min(modalBox.x, pickerBox.x),
    y: modalBox.y,
    width: Math.max(modalBox.x + modalBox.width, pickerBox.x + pickerBox.width) - Math.min(modalBox.x, pickerBox.x),
    height: pickerBox.y + pickerBox.height - modalBox.y,
  };
  await page.screenshot({
    path: join(OUT_DIR, "due-date-picker.png"),
    clip: paddedBox(combinedDueBox, { top: 14, right: 16, bottom: 28, left: 16 }),
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".due-picker")).toHaveCount(0);

  // 11. attachments.png
  const attArea = page.locator(".modal-content .attachments-area");
  await attArea.scrollIntoViewIfNeeded();
  await settleUi(page, 250);
  const attBox = (await attArea.boundingBox())!;
  await page.screenshot({
    path: join(OUT_DIR, "attachments.png"),
    clip: paddedBox(attBox, { top: 8, right: 24, bottom: 16, left: 24 }),
  });

  // 12. card-history.png
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.locator(".history-dialog")).toBeVisible();
  await expect(page.locator(".history-item").first()).toBeVisible();
  await settleUi(page);
  await page.screenshot({ path: join(OUT_DIR, "card-history.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".history-dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  // 13. dark-mode.png
  await apiJson(request, "PUT", "/api/settings", { theme: "dark" });
  await page.reload();
  await expect(page.locator("html.theme-dark")).toHaveCount(1);
  await expect(page.locator(".list")).toHaveCount(4);
  await settleUi(page, 400);
  await page.screenshot({ path: join(OUT_DIR, "dark-mode.png") });
  await apiJson(request, "PUT", "/api/settings", { theme: "light" });

  // 14. notes-mode.png
  await page.goto(`/board/${archBoard.id}`);
  await expect(page.locator(".notes-view")).toBeVisible();
  await expect(page.locator(".notes-detail .ProseMirror img.editor-image")).toBeVisible();
  // Keep clean visual state without blinking cursor inside editor
  await page.locator(".notes-master .card--selected").focus();
  await settleUi(page, 400);
  await page.screenshot({ path: join(OUT_DIR, "notes-mode.png") });

  // 15. matrix.png
  await page.locator(".notes-master .card", { hasText: "Platform Support Matrix" }).click();
  const matrixTable = page.locator(".notes-detail table[data-matrix]");
  await expect(matrixTable).toBeVisible();
  await settleUi(page, 350);
  const editorWrapperBox = (await page.locator(".notes-detail .editor-wrapper").boundingBox())!;
  const matrixBox = (await matrixTable.boundingBox())!;
  const matrixClipBox = {
    x: editorWrapperBox.x,
    y: editorWrapperBox.y,
    width: editorWrapperBox.width,
    height: matrixBox.y + matrixBox.height - editorWrapperBox.y,
  };
  await page.screenshot({
    path: join(OUT_DIR, "matrix.png"),
    clip: paddedBox(matrixClipBox, { top: 14, right: 14, bottom: 20, left: 4 }),
  });

  // 16. pdf-export-preview.png (rendered from real GET /api/cards/:id/pdf)
  const pdfRes = await request.get(`/api/cards/${syncCard.id}/pdf`);
  expect(pdfRes.ok()).toBe(true);
  const pdfTmp = mkdtempSync(join(tmpdir(), "synkban-pdf-preview-"));
  try {
    const pdfPath = join(pdfTmp, "card.pdf");
    writeFileSync(pdfPath, await pdfRes.body());
    execFileSync("pdftoppm", ["-png", "-r", "150", pdfPath, join(pdfTmp, "page")]);
    const pageFiles = readdirSync(pdfTmp)
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();
    expect(pageFiles.length).toBeGreaterThan(0);

    const imgsHtml = pageFiles
      .slice(0, 2)
      .map((f) => {
        const dataUri = `data:image/png;base64,${readFileSync(join(pdfTmp, f)).toString("base64")}`;
        return `<div class="sheet"><img src="${dataUri}" /></div>`;
      })
      .join("");

    const pdfCtx = await browser.newContext({
      viewport: { width: 1200, height: 820 },
      deviceScaleFactor: 2,
    });
    const pdfPage = await pdfCtx.newPage();
    await pdfPage.setContent(`
      <!doctype html>
      <html>
        <body style="margin:0;background:#e8edf3;padding:24px;display:inline-block;">
          <div id="frame" style="display:flex;gap:22px;align-items:flex-start;">
            ${imgsHtml}
          </div>
          <style>
            .sheet {
              background: #fff;
              border: 1px solid #cbd5e1;
              border-radius: 6px;
              box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
              overflow: hidden;
              width: 480px;
            }
            .sheet img {
              display: block;
              width: 100%;
              height: auto;
            }
          </style>
        </body>
      </html>
    `);
    await settleUi(pdfPage, 150);
    const frameBox = (await pdfPage.locator("#frame").boundingBox())!;
    await pdfPage.screenshot({
      path: join(OUT_DIR, "pdf-export-preview.png"),
      clip: {
        x: Math.max(0, Math.floor(frameBox.x - 24)),
        y: Math.max(0, Math.floor(frameBox.y - 24)),
        width: Math.ceil(frameBox.width + 48),
        height: Math.ceil(frameBox.height + 48),
      },
    });
    await pdfCtx.close();
  } finally {
    rmSync(pdfTmp, { recursive: true, force: true });
  }

  // 17. mobile-notes.png (stacked narrow/mobile layout < 760px)
  const mobileCtx = await browser.newContext({
    viewport: { width: 500, height: 880 },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto(`/board/${archBoard.id}`);
  await expect(mobilePage.locator(".notes-view")).toBeVisible();
  await expect(mobilePage.locator(".notes-detail .ProseMirror img.editor-image")).toBeVisible();
  await settleUi(mobilePage, 350);
  await mobilePage.screenshot({ path: join(OUT_DIR, "mobile-notes.png") });
  await mobileCtx.close();
});
