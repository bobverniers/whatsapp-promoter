export const INTERVAL_MODES = [
  "fixed_5m",
  "jitter_2_5_3_5h",
  "jitter_3_5_4_5h",
  "jitter_4_5_5_5h",
  "jitter_6_8h",
  "fixed_16h",
  "fixed_1d",
  "fixed_2d",
  "fixed_3d",
  "fixed_4d",
  "fixed_5d",
] as const;

export type IntervalMode = (typeof INTERVAL_MODES)[number];

export const INTERVAL_OPTIONS: { value: IntervalMode; label: string }[] = [
  { value: "fixed_5m", label: "Every 5 minutes" },
  { value: "jitter_2_5_3_5h", label: "Every 2.5-3.5 hours" },
  { value: "jitter_3_5_4_5h", label: "Every 3.5-4.5 hours" },
  { value: "jitter_4_5_5_5h", label: "Every 4.5-5.5 hours" },
  { value: "jitter_6_8h", label: "Every 6-8 hours" },
  { value: "fixed_16h", label: "Every 16 hours" },
  { value: "fixed_1d", label: "Every day" },
  { value: "fixed_2d", label: "Every 2 days" },
  { value: "fixed_3d", label: "Every 3 days" },
  { value: "fixed_4d", label: "Every 4 days" },
  { value: "fixed_5d", label: "Every 5 days" },
];

export function normalizeIntervalMode(value: unknown): IntervalMode {
  if (typeof value === "string" && INTERVAL_MODES.includes(value as IntervalMode)) {
    return value as IntervalMode;
  }
  return "fixed_5m";
}

/** Min/max minutes between sends (equal for fixed modes). */
export function intervalRangeMinutes(
  mode: string | null | undefined,
  intervalMinutes: number | null | undefined
): [number, number] {
  switch (mode) {
    case "fixed_5m":
      return [5, 5];
    case "jitter_2_5_3_5h":
      return [150, 210];
    case "jitter_3_5_4_5h":
      return [210, 270];
    case "jitter_4_5_5_5h":
      return [270, 330];
    case "jitter_6_8h":
      return [360, 480];
    case "fixed_16h":
      return [960, 960];
    case "fixed_1d":
      return [1440, 1440];
    case "fixed_2d":
      return [2880, 2880];
    case "fixed_3d":
      return [4320, 4320];
    case "fixed_4d":
      return [5760, 5760];
    case "fixed_5d":
      return [7200, 7200];
    default: {
      const mins =
        typeof intervalMinutes === "number" && intervalMinutes > 0
          ? intervalMinutes
          : 15;
      return [mins, mins];
    }
  }
}

/** Stored `interval_minutes` for a known mode (uses range minimum). */
export function canonicalIntervalMinutes(mode: IntervalMode): number {
  return intervalRangeMinutes(mode, null)[0];
}
