/** Presets for schedules (standard 5-field cron). */
export const CRON_INTERVAL_PRESETS = [
  { id: "5m", label: "Every 5 minutes", expr: "*/5 * * * *" },
  { id: "15m", label: "Every 15 minutes", expr: "*/15 * * * *" },
  { id: "1h", label: "Every hour (minute 0)", expr: "0 * * * *" },
  { id: "3h", label: "Every 3 hours (minute 0)", expr: "0 */3 * * *" },
  { id: "daily9utc", label: "Daily at 09:00 UTC", expr: "0 9 * * *" },
] as const;

export type CronPresetId = (typeof CRON_INTERVAL_PRESETS)[number]["id"];

export function normalizeCronExpr(expr: string): string {
  return expr.trim().replace(/\s+/g, " ");
}

/** Returns preset id, or `"custom"` if no preset matches (after normalization). */
export function matchCronPreset(expr: string): CronPresetId | "custom" {
  const norm = normalizeCronExpr(expr);
  for (const p of CRON_INTERVAL_PRESETS) {
    if (p.expr === norm) return p.id;
  }
  return "custom";
}

export function labelForCronExpr(expr: string): string {
  const id = matchCronPreset(expr);
  if (id === "custom") return normalizeCronExpr(expr);
  const p = CRON_INTERVAL_PRESETS.find((x) => x.id === id);
  return p?.label ?? expr;
}
