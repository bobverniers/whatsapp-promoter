/** Valid UUID strings from an unknown payload (drops invalid strings). */
export function normalizeUuidList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const re =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of input) {
    if (typeof x !== "string") continue;
    const id = x.trim();
    if (!re.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
