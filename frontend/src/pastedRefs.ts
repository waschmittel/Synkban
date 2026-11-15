/// Pasted image references must be valid in the card they land in (ADR-0020).
/// The editor's clipboard HTML tags each reference `<card>/<attachment>`; here
/// they are re-pointed: own attachments are kept, other cards' attachments are
/// copied over, anything unknown (deleted, malformed) is dropped.

import { Fragment, Slice } from "prosemirror-model";
import { schema } from "./schema";

/// `copy(fromCard, attId)` resolves to the new attachment's id (undefined = failed).
export async function resolvePastedImages(
  slice: Slice,
  cardId: string,
  known: Set<string>,
  copy: (fromCard: string, attId: string) => Promise<string | undefined>,
): Promise<Slice> {
  const resolve = async (frag: Fragment): Promise<Fragment> => {
    const out = [];
    for (let i = 0; i < frag.childCount; i++) {
      const n = frag.child(i);
      if (n.type !== schema.nodes.image) {
        out.push(n.isLeaf ? n : n.copy(await resolve(n.content)));
        continue;
      }
      const [from, id] = String(n.attrs.att).includes("/")
        ? String(n.attrs.att).split("/")
        : [cardId, String(n.attrs.att)];
      const att = from === cardId ? (known.has(id) ? id : undefined) : await copy(from, id);
      if (att) out.push(n.type.create({ ...n.attrs, att }));
    }
    return Fragment.fromArray(out);
  };
  return new Slice(await resolve(slice.content), slice.openStart, slice.openEnd);
}
