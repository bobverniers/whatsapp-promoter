/** Keep prior order for still-eligible ids; append newly eligible ids at the end. */
export function buildStableRotationOrder(
  storedOrder: string[] | null | undefined,
  eligibleIds: string[],
  bootstrapOrder: string[],
  sortNewIds?: (ids: string[]) => string[]
): string[] {
  const eligible = new Set(eligibleIds);
  const kept: string[] = [];
  const seen = new Set<string>();
  const base =
    Array.isArray(storedOrder) && storedOrder.length > 0
      ? storedOrder
      : bootstrapOrder;

  for (const id of base) {
    if (!eligible.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }

  const newcomers = eligibleIds.filter((id) => !seen.has(id));
  const sortNew = sortNewIds ?? ((ids) => [...ids].sort((a, b) => a.localeCompare(b)));
  return [...kept, ...sortNew(newcomers)];
}
