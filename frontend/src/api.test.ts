import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

function mockFetch(response: Partial<Response>) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    ...response,
  });
  globalThis.fetch = fn;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("URL builders", () => {
  it("getAttachmentUrl builds correct path", () => {
    expect(api.getAttachmentUrl("card-1", "att-2")).toBe(
      "/api/cards/card-1/attachments/att-2"
    );
  });

  it("getAttachmentThumbUrl builds correct path", () => {
    expect(api.getAttachmentThumbUrl("card-1", "att-2")).toBe(
      "/api/cards/card-1/attachments/att-2/thumb"
    );
  });
});

describe("request helper", () => {
  it("sends GET with JSON content-type", async () => {
    const boards = [{ id: "1", title: "Board" }];
    const fn = mockFetch({ json: () => Promise.resolve(boards) });
    const result = await api.listBoards();
    expect(result).toEqual(boards);
    expect(fn).toHaveBeenCalledWith(
      "/api/boards",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("throws on non-ok response with error message", async () => {
    mockFetch({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => Promise.resolve({ error: "Board not found" }),
    });
    await expect(api.getBoard("fake")).rejects.toThrow("Board not found");
  });

  it("throws with statusText when error JSON fails", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("parse fail")),
    });
    await expect(api.listBoards()).rejects.toThrow("Internal Server Error");
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch({ status: 204 });
    const result = await api.deleteBoard("id");
    expect(result).toBeUndefined();
  });
});

describe("board operations", () => {
  it("createBoard sends POST with title", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({ id: "1" }) });
    await api.createBoard("My Board");
    expect(fn).toHaveBeenCalledWith(
      "/api/boards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "My Board" }),
      })
    );
  });

  it("updateBoard sends PUT with color", async () => {
    const fn = mockFetch({});
    await api.updateBoard("id", { title: "Title", color: "#ff0000" });
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/id",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ title: "Title", color: "#ff0000" }),
      })
    );
  });

  it("updateBoard sends null color to clear", async () => {
    const fn = mockFetch({});
    await api.updateBoard("id", { title: "Title", color: null });
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/id",
      expect.objectContaining({
        body: JSON.stringify({ title: "Title", color: null }),
      })
    );
  });

  it("deleteBoard sends DELETE", async () => {
    const fn = mockFetch({ status: 204 });
    await api.deleteBoard("board-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/board-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("checkChanges calls correct endpoint", async () => {
    const fn = mockFetch({ json: () => Promise.resolve({ mtime: 123, boards: { "b-1": 123 } }) });
    const result = await api.checkChanges();
    expect(result).toEqual({ mtime: 123, boards: { "b-1": 123 } });
    expect(fn).toHaveBeenCalledWith("/api/changes", expect.anything());
  });

  it("getArchivedCards uses board-scoped path", async () => {
    const fn = mockFetch({ json: () => Promise.resolve([]) });
    await api.getArchivedCards("board-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/board-1/archive",
      expect.anything()
    );
  });

  it("reorderBoards sends PUT with ordered ids", async () => {
    const fn = mockFetch({ status: 204 });
    await api.reorderBoards(["c", "a", "b"]);
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/order",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ ids: ["c", "a", "b"] }),
      })
    );
  });
});

describe("list operations", () => {
  it("createList sends POST to board-scoped path", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({}) });
    await api.createList("board-1", "To Do");
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/board-1/lists",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "To Do" }),
      })
    );
  });

  it("updateList sends PUT", async () => {
    const fn = mockFetch({});
    await api.updateList("list-1", { title: "Done", position: 2.5 });
    expect(fn).toHaveBeenCalledWith(
      "/api/lists/list-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ title: "Done", position: 2.5 }),
      })
    );
  });

  it("deleteList sends DELETE", async () => {
    const fn = mockFetch({ status: 204 });
    await api.deleteList("list-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/lists/list-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("card operations", () => {
  it("createCard sends POST to list-scoped path", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({}) });
    await api.createCard("list-1", "Task");
    expect(fn).toHaveBeenCalledWith(
      "/api/lists/list-1/cards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Task" }),
      })
    );
  });

  it("updateCard sends PUT with fields", async () => {
    const fn = mockFetch({});
    await api.updateCard("card-1", { title: "New", archived: true });
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ title: "New", archived: true }),
      })
    );
  });

  it("archiveCard sends PUT with archived:true", async () => {
    const fn = mockFetch({});
    await api.archiveCard("card-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1",
      expect.objectContaining({
        body: JSON.stringify({ archived: true }),
      })
    );
  });

  it("restoreCard without listId", async () => {
    const fn = mockFetch({});
    await api.restoreCard("card-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1",
      expect.objectContaining({
        body: JSON.stringify({ archived: false }),
      })
    );
  });

  it("restoreCard with listId", async () => {
    const fn = mockFetch({});
    await api.restoreCard("card-1", "list-2");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1",
      expect.objectContaining({
        body: JSON.stringify({ archived: false, list_id: "list-2" }),
      })
    );
  });

  it("deleteCard sends DELETE", async () => {
    const fn = mockFetch({ status: 204 });
    await api.deleteCard("card-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("checklist operations", () => {
  it("addChecklistItem sends POST with text", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({}) });
    await api.addChecklistItem("card-1", "Buy milk");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/checklist",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Buy milk" }),
      })
    );
  });

  it("updateChecklistItem sends PUT with done", async () => {
    const fn = mockFetch({});
    await api.updateChecklistItem("card-1", "item-1", { done: true });
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/checklist/item-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ done: true }),
      })
    );
  });

  it("updateChecklistItem sends PUT with text", async () => {
    const fn = mockFetch({});
    await api.updateChecklistItem("card-1", "item-1", { text: "Renamed" });
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/checklist/item-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ text: "Renamed" }),
      })
    );
  });

  it("deleteChecklistItem sends DELETE to nested path", async () => {
    const fn = mockFetch({ status: 204 });
    await api.deleteChecklistItem("card-1", "item-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/checklist/item-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("setChecklistAll sends PUT to collection path", async () => {
    const fn = mockFetch({});
    await api.setChecklistAll("card-1", true);
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/checklist",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ done: true }),
      })
    );
  });
});

describe("label operations", () => {
  it("createLabel sends POST to board-scoped path", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({}) });
    await api.createLabel("board-1", "Bug");
    expect(fn).toHaveBeenCalledWith(
      "/api/boards/board-1/labels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Bug" }),
      })
    );
  });

  it("updateLabel sends PUT", async () => {
    const fn = mockFetch({});
    await api.updateLabel("label-1", "Feature");
    expect(fn).toHaveBeenCalledWith(
      "/api/labels/label-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Feature" }),
      })
    );
  });

  it("deleteLabel sends DELETE", async () => {
    const fn = mockFetch({ status: 204 });
    await api.deleteLabel("label-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/labels/label-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("attachment operations", () => {
  it("deleteAttachment sends DELETE to nested path", async () => {
    const fn = mockFetch({ status: 204 });
    await api.deleteAttachment("card-1", "att-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/attachments/att-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("uploadAttachment posts file as raw body with filename query + content-type header", async () => {
    const att = { id: "att-1", filename: "doc.pdf", size: 4, content_type: "application/pdf", created_at: "x" };
    const fn = mockFetch({ status: 201, json: () => Promise.resolve(att) });
    const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
    const result = await api.uploadAttachment("card-1", file);
    expect(result).toEqual(att);
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/attachments?filename=doc.pdf",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      })
    );
  });

  it("uploadAttachment URL-encodes filename with spaces", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({}) });
    const file = new File(["x"], "my file.txt", { type: "text/plain" });
    await api.uploadAttachment("card-1", file);
    expect(fn).toHaveBeenCalledWith(
      "/api/cards/card-1/attachments?filename=my%20file.txt",
      expect.anything()
    );
  });

  it("uploadAttachment falls back to application/octet-stream when file.type is empty", async () => {
    const fn = mockFetch({ status: 201, json: () => Promise.resolve({}) });
    const file = new File(["x"], "raw.bin", { type: "" });
    await api.uploadAttachment("card-1", file);
    expect(fn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { "Content-Type": "application/octet-stream" },
      })
    );
  });

  it("uploadAttachment throws on non-ok response with error message", async () => {
    mockFetch({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      json: () => Promise.resolve({ error: "File too large (max 50 MB)" }),
    });
    const file = new File(["big"], "big.bin", { type: "application/octet-stream" });
    await expect(api.uploadAttachment("card-1", file)).rejects.toThrow("File too large");
  });

  it("uploadAttachment falls back to statusText when error JSON fails", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("nope")),
    });
    const file = new File(["x"], "f.txt", { type: "text/plain" });
    await expect(api.uploadAttachment("card-1", file)).rejects.toThrow("Internal Server Error");
  });
});
