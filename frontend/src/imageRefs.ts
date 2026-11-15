/// Inline image references (`image` nodes, ADR-0020) in a serialized
/// description (ProseMirror doc JSON; "" = empty).

type Json = { type?: string; attrs?: { att?: string }; content?: Json[] };

function parse(description: string): Json | null {
  if (!description.includes('"image"')) return null;
  try {
    return JSON.parse(description);
  } catch {
    return null;
  }
}

/// Attachment ids referenced by the description.
export function imageRefIds(description: string): Set<string> {
  const ids = new Set<string>();
  const walk = (n: Json) => {
    if (n.type === "image" && n.attrs?.att) ids.add(n.attrs.att);
    n.content?.forEach(walk);
  };
  const doc = parse(description);
  if (doc) walk(doc);
  return ids;
}

/// The description without references to `attId`.
export function stripImageRefs(description: string, attId: string): string {
  const doc = parse(description);
  if (!doc) return description;
  const strip = (n: Json) => {
    if (!n.content) return;
    n.content = n.content.filter((c) => !(c.type === "image" && c.attrs?.att === attId));
    n.content.forEach(strip);
  };
  strip(doc);
  return JSON.stringify(doc);
}
