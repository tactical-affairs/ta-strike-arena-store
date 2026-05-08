/**
 * Parse the markdown manual into a flat TOC for the left rail.
 *
 * We only treat `## ` and `### ` as TOC entries — `# ` is the document
 * title and shouldn't appear twice; `####` and deeper are section
 * details, not navigation targets.
 *
 * `id` matches the slug we apply to the rendered heading via the
 * Content component, so clicking a TOC link scrolls to that heading.
 */

export type TocEntry = {
  id: string;
  level: 2 | 3;
  text: string;
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function parseToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  // Skip any heading that appears inside a fenced code block — `### foo`
  // inside a ```bash block is a comment, not a section header.
  const lines = markdown.split("\n");
  let inFence = false;
  for (const raw of lines) {
    if (raw.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(##|###)\s+(.+?)\s*$/.exec(raw);
    if (!match) continue;
    const level = match[1].length === 2 ? 2 : 3;
    const text = match[2].trim();
    let id = slugify(text);
    // Disambiguate duplicate headings with a numeric suffix so anchors
    // remain stable.
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count}`;
    entries.push({ id, level: level as 2 | 3, text });
  }
  return entries;
}

/**
 * Filter the TOC by a search term against heading text. Always keeps
 * the parent `##` of a matched `###` so the TOC stays navigable.
 */
export function filterToc(entries: TocEntry[], search: string): TocEntry[] {
  const q = search.trim().toLowerCase();
  if (!q) return entries;

  const matched = new Set<number>();
  entries.forEach((e, i) => {
    if (e.text.toLowerCase().includes(q)) matched.add(i);
  });
  if (matched.size === 0) return [];

  // Promote every matched entry plus the nearest preceding `##` parent.
  const keep = new Set<number>();
  for (const i of matched) {
    keep.add(i);
    if (entries[i].level === 3) {
      for (let j = i - 1; j >= 0; j--) {
        if (entries[j].level === 2) {
          keep.add(j);
          break;
        }
      }
    }
  }
  return entries.filter((_, i) => keep.has(i));
}
