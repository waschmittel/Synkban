/// Image files on the clipboard, or none when the paste carries text too
/// (e.g. from Word) — then the text paste wins. Clipboard images are all
/// called "image.png", so they get a timestamped, unique name.
export function pastedImageFiles(data: DataTransfer | null, now = Date.now()): File[] {
  if (!data || data.getData("text/plain")) return [];
  return Array.from(data.files)
    .filter((f) => f.type.startsWith("image/"))
    .map((f, i) => {
      const ext = f.type.split("/")[1]?.split("+")[0] || "png";
      return new File([f], `pasted-${now}-${i + 1}.${ext}`, { type: f.type });
    });
}
