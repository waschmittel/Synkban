// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeLinkHref } from "./proseEditor";

describe("sanitizeLinkHref", () => {
  it("allows http, https and mailto", () => {
    expect(sanitizeLinkHref("http://example.com")).toBe("http://example.com");
    expect(sanitizeLinkHref("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(sanitizeLinkHref("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("prefixes www. with https://", () => {
    expect(sanitizeLinkHref("www.example.com")).toBe("https://www.example.com");
  });

  it("rejects javascript: and data: URIs", () => {
    expect(sanitizeLinkHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeLinkHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects obfuscated schemes", () => {
    expect(sanitizeLinkHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(sanitizeLinkHref(" javascript:alert(1)")).toBeNull();
    expect(sanitizeLinkHref("\tjavascript:alert(1)")).toBeNull();
  });

  it("rejects relative URLs and other schemes", () => {
    expect(sanitizeLinkHref("/boards/123")).toBeNull();
    expect(sanitizeLinkHref("example.com")).toBeNull();
    expect(sanitizeLinkHref("file:///etc/passwd")).toBeNull();
    expect(sanitizeLinkHref("vbscript:msgbox(1)")).toBeNull();
  });
});
