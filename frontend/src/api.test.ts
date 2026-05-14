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
    const fn = mockFetch({ json: () => Promise.resolve({ mtime: 123 }) });
    const result = await api.checkChanges();
    expect(result).toEqual({ mtime: 123 });
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
});
