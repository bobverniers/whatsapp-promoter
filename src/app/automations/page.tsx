"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { TagsEditor } from "@/components/TagsEditor";
import {
  CRON_INTERVAL_PRESETS,
  labelForCronExpr,
  matchCronPreset,
  normalizeCronExpr,
} from "@/lib/cron-intervals";

type AutomationConfig = {
  id: string;
  name: string;
  enabled: boolean;
  cron_expr: string;
  group_tags: string[] | null;
  group_include_ids: string[] | null;
  group_exclude_ids: string[] | null;
  template_ids: string[] | null;
  last_run_at: string | null;
};

type GroupRow = {
  id: string;
  whapi_id: string;
  name: string | null;
  is_active: boolean;
  tags: unknown;
  last_promoted_at: string | null;
};

type TemplateRow = {
  id: string;
  content: string;
  tags: unknown;
  use_count: number;
  last_used_at: string | null;
};

type RunRow = {
  id: string;
  automation_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  groups_targeted: number;
  groups_sent: number;
  groups_failed: number;
  error_summary: string | null;
};

function api(path: string, opts: RequestInit = {}) {
  const password =
    typeof window !== "undefined"
      ? sessionStorage.getItem("admin_pw") ?? ""
      : "";
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": password,
      ...(opts.headers ?? {}),
    },
  });
}

function asTagList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeLocalConfig(raw: AutomationConfig): AutomationConfig {
  return {
    ...raw,
    group_tags: asTagList(raw.group_tags),
    group_include_ids: Array.isArray(raw.group_include_ids)
      ? raw.group_include_ids.filter((x): x is string => typeof x === "string")
      : [],
    group_exclude_ids: Array.isArray(raw.group_exclude_ids)
      ? raw.group_exclude_ids.filter((x): x is string => typeof x === "string")
      : [],
    template_ids: Array.isArray(raw.template_ids)
      ? raw.template_ids.filter((x): x is string => typeof x === "string")
      : [],
  };
}

function isEffectiveTarget(
  g: Pick<GroupRow, "id" | "is_active" | "tags">,
  filterTags: string[],
  include: Set<string>,
  exclude: Set<string>
): boolean {
  if (exclude.has(g.id)) return false;
  if (!g.is_active) return false;
  if (include.has(g.id)) return true;
  const tags = asTagList(g.tags);
  if (filterTags.length === 0) return false;
  return tags.some((t) => filterTags.includes(t));
}

export default function AutomationsPage() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<{
    kind: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [localConfig, setLocalConfig] = useState<AutomationConfig | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunRow[]>([]);
  const [groupSearch, setGroupSearch] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      if (sessionStorage.getItem("admin_pw")) setAuthed(true);
    });
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    const res = await api("/api/automations/config");
    const data = await res.json();
    if (!res.ok) {
      setBanner({
        kind: "error",
        text: data.details
          ? `${data.error}: ${data.details}`
          : data.error ?? "Failed to load",
      });
      setLoading(false);
      return;
    }
    setLocalConfig(normalizeLocalConfig(data.config as AutomationConfig));
    setGroups(data.groups ?? []);
    setTemplates(data.templates ?? []);
    setRecentRuns(data.recentRuns ?? []);
    if (data.errors?.runs || data.errors?.groups || data.errors?.templates) {
      const parts = [
        data.errors.groups && `groups: ${data.errors.groups}`,
        data.errors.templates && `templates: ${data.errors.templates}`,
        data.errors.runs && `runs: ${data.errors.runs}`,
      ].filter(Boolean);
      if (parts.length) {
        setBanner({ kind: "info", text: `Partial load: ${parts.join(" · ")}` });
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authed) return;
    queueMicrotask(() => void fetchAll());
  }, [authed, fetchAll]);

  const filterTags = asTagList(localConfig?.group_tags);
  const includeSet = useMemo(
    () => new Set(localConfig?.group_include_ids ?? []),
    [localConfig?.group_include_ids]
  );
  const excludeSet = useMemo(
    () => new Set(localConfig?.group_exclude_ids ?? []),
    [localConfig?.group_exclude_ids]
  );

  const targetedChats = useMemo(() => {
    if (!localConfig) return [];
    const list = groups.filter((g) =>
      isEffectiveTarget(g, filterTags, includeSet, excludeSet)
    );
    return [...list].sort((a, b) =>
      (a.name || a.whapi_id).localeCompare(b.name || b.whapi_id, undefined, {
        sensitivity: "base",
      })
    );
  }, [groups, filterTags, includeSet, excludeSet, localConfig]);

  const targetedCount = targetedChats.length;

  const cronPresetId = localConfig
    ? matchCronPreset(localConfig.cron_expr ?? "")
    : "custom";

  const knownTags = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) {
      for (const t of asTagList(g.tags)) s.add(t);
    }
    return [...s].sort();
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      const name = (g.name ?? "").toLowerCase();
      const id = g.whapi_id.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [groups, groupSearch]);

  async function handleSave() {
    if (!localConfig) return;
    setSaving(true);
    setBanner(null);
    const res = await api("/api/automations/config", {
      method: "PATCH",
      body: JSON.stringify({
        name: localConfig.name,
        enabled: localConfig.enabled,
        cron_expr: normalizeCronExpr(localConfig.cron_expr),
        group_tags: localConfig.group_tags,
        group_include_ids: localConfig.group_include_ids,
        group_exclude_ids: localConfig.group_exclude_ids,
        template_ids: localConfig.template_ids,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner({
        kind: "error",
        text: data.details
          ? `${data.error}: ${data.details}`
          : data.error ?? "Save failed",
      });
    } else {
      setLocalConfig(normalizeLocalConfig(data as AutomationConfig));
      setBanner({ kind: "success", text: "Saved automation settings." });
    }
    setSaving(false);
    await fetchAll();
  }

  async function handleRunNow() {
    setRunning(true);
    setBanner(null);
    const res = await api("/api/automations/run-now", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setBanner({
        kind: "error",
        text: data.details
          ? `${data.error}: ${data.details}`
          : data.error ?? "Run failed",
      });
    } else {
      const lines: string[] = [];
      if (data.skipped) {
        lines.push(`Skipped (${data.reason ?? "reason unknown"})`);
      } else {
        lines.push(
          `status: ${data.status} · targeted ${data.groupsTargeted} · sent ${data.groupsSent} · failed ${data.groupsFailed}`
        );
      }
      if (
        Array.isArray(data.messages) &&
        data.messages.length > 0
      ) {
        lines.push(
          ...(data.messages as string[])
            .filter((x) => typeof x === "string")
            .slice(0, 5)
        );
      }
      const isErr =
        !data.skipped &&
        typeof data.status === "string" &&
        data.status === "failed";
      setBanner({
        kind: data.skipped ? "info" : isErr ? "error" : "success",
        text: lines.join("\n"),
      });
    }
    setRunning(false);
    await fetchAll();
  }

  function toggleInclude(id: string) {
    setLocalConfig((prev) => {
      if (!prev) return prev;
      const inc = new Set(prev.group_include_ids ?? []);
      const exc = new Set(prev.group_exclude_ids ?? []);
      if (inc.has(id)) inc.delete(id);
      else {
        inc.add(id);
        exc.delete(id);
      }
      return {
        ...prev,
        group_include_ids: [...inc],
        group_exclude_ids: [...exc],
      };
    });
  }

  function toggleExclude(id: string) {
    setLocalConfig((prev) => {
      if (!prev) return prev;
      const inc = new Set(prev.group_include_ids ?? []);
      const exc = new Set(prev.group_exclude_ids ?? []);
      if (exc.has(id)) exc.delete(id);
      else {
        exc.add(id);
        inc.delete(id);
      }
      return {
        ...prev,
        group_include_ids: [...inc],
        group_exclude_ids: [...exc],
      };
    });
  }

  function toggleTemplate(id: string) {
    setLocalConfig((prev) => {
      if (!prev) return prev;
      const s = new Set(prev.template_ids ?? []);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return { ...prev, template_ids: [...s] };
    });
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100">
        <p className="text-sm text-zinc-400">
          Log in on the Dashboard first (same admin password).
        </p>
        <Link
          href="/"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">Automations</h1>
            <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
              Dashboard
            </Link>
          </div>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem("admin_pw");
              window.location.reload();
            }}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {loading || !localConfig ? (
          <p className="py-16 text-center text-zinc-500">Loading...</p>
        ) : (
          <>
            {banner && (
              <div
                className={`mb-6 whitespace-pre-wrap rounded-lg border px-4 py-2.5 text-sm ${
                  banner.kind === "success"
                    ? "border-emerald-900/50 bg-emerald-900/20 text-emerald-300"
                    : banner.kind === "error"
                      ? "border-red-900/50 bg-red-900/20 text-red-300"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
                }`}
              >
                {banner.text}
              </div>
            )}

            <section className="mb-8 rounded-xl border border-blue-900/40 bg-blue-950/10 p-5">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-blue-400/90">
                Open tasks
              </h2>
              <p className="mb-4 text-xs text-zinc-500">
                Each automation is one task here. Tune targeting below,
                Save, then track runs under{" "}
                <span className="text-zinc-400">Task history</span>.
              </p>

              <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs text-zinc-500">
                      Task name
                    </label>
                    <input
                      value={localConfig.name}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, name: e.target.value })
                      }
                      className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        localConfig.enabled
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {localConfig.enabled ? "Scheduled: on" : "Scheduled: paused"}
                    </span>
                  </div>
                </div>

                <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={localConfig.enabled}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        enabled: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-600"
                  />
                  Enabled{" "}
                  <span className="text-xs text-zinc-500">
                    (Scheduled runs skip while off — Run now still works.)
                  </span>
                </label>

                <div className="mb-3 grid gap-3 md:grid-cols-2 md:items-end">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">
                      Schedule preset
                    </label>
                    <select
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
                      value={
                        cronPresetId === "custom" ? "custom" : cronPresetId
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "custom") return;
                        const row = CRON_INTERVAL_PRESETS.find(
                          (p) => p.id === v
                        );
                        if (row) {
                          setLocalConfig({
                            ...localConfig,
                            cron_expr: row.expr,
                          });
                        }
                      }}
                    >
                      {CRON_INTERVAL_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                      <option value="custom">Custom cron…</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">
                      Cron expression
                    </label>
                    <input
                      readOnly={cronPresetId !== "custom"}
                      value={localConfig.cron_expr}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          cron_expr: normalizeCronExpr(e.target.value),
                        })
                      }
                      spellCheck={false}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 outline-none read-only:bg-zinc-900/70 read-only:text-zinc-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                <p className="mb-4 text-[11px] leading-relaxed text-amber-200/70">
                  <strong className="text-amber-200">Scheduler:</strong> automation
                  runs on a{" "}
                  <code className="text-zinc-400">cron</code> in{" "}
                  <code className="text-zinc-400">
                    .github/workflows/automation-schedule.yml
                  </code>{" "}
                  (GitHub Actions, UTC). Daily app health still uses Vercel Cron
                  for <code className="text-zinc-400">/api/heartbeat</code> only.
                  When you change cadence, update that workflow and keep this
                  expression in sync for clarity (
                  {labelForCronExpr(localConfig.cron_expr)} ·{" "}
                  <span className="font-mono">
                    {normalizeCronExpr(localConfig.cron_expr)}
                  </span>
                  ).
                </p>

                <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  <span>
                    Last run:{" "}
                    <span className="text-zinc-300">
                      {localConfig.last_run_at
                        ? new Date(localConfig.last_run_at).toLocaleString()
                        : "—"}
                    </span>
                  </span>
                </div>

                <div className="mb-4">
                  <p className="mb-1 text-xs font-medium text-zinc-400">
                    Chats targeted by this task ({targetedCount})
                  </p>
                  {targetedCount === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No chats match yet — add matching tags or use Include.
                    </p>
                  ) : (
                    <ul className="max-h-40 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300">
                      {targetedChats.map((g) => (
                        <li key={g.id} className="border-b border-zinc-800/80 py-1.5 last:border-0">
                          <span className="font-medium text-zinc-200">
                            {g.name ?? g.whapi_id}
                          </span>
                          {g.name && (
                            <span className="ml-2 text-zinc-500">
                              ({g.whapi_id})
                            </span>
                          )}
                          {asTagList(g.tags).length > 0 && (
                            <span className="mt-1 block text-zinc-500">
                              tags:{" "}
                              <span className="text-zinc-400">
                                {asTagList(g.tags).join(", ")}
                              </span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={running}
                    onClick={handleRunNow}
                    className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-50"
                  >
                    {running ? "Running…" : "Run now"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSave}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save task"}
                  </button>
                </div>
              </div>
            </section>

            <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="mb-2 text-sm font-semibold text-zinc-200">
                Task targeting · groups (hybrid)
              </h2>
              <p className="mb-4 text-xs text-zinc-500">
                Matches any chat that shares at least one tag below{" "}
                <strong className="text-zinc-400">or</strong> is explicitly
                included. Exclude always wins.
              </p>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-600">
                Filter tags (dynamic matches)
              </p>
              <div className="mb-4 max-w-xl">
                <TagsEditor
                  value={asTagList(localConfig.group_tags)}
                  knownTags={knownTags}
                  onChange={(group_tags) =>
                    setLocalConfig({ ...localConfig, group_tags })
                  }
                />
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-md bg-blue-950/80 px-2 py-1 text-blue-300">
                  Currently targeted chats:{" "}
                  <strong>{targetedCount}</strong>
                </span>
                <span className="text-xs text-zinc-500">
                  (listed under Open tasks above)
                </span>
              </div>
              <input
                placeholder="Search groups…"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                className="mb-3 w-full max-w-md rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-blue-500"
              />
              <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-zinc-800 bg-zinc-900/70 text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Chat</th>
                      <th className="px-3 py-2">Included</th>
                      <th className="px-3 py-2">Excluded</th>
                      <th className="px-3 py-2 text-right">Matched</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {filteredGroups.map((g) => {
                      const inc = includeSet.has(g.id);
                      const exc = excludeSet.has(g.id);
                      const match = isEffectiveTarget(
                        g,
                        filterTags,
                        includeSet,
                        excludeSet
                      );
                      const label =
                        g.name ?? (
                          <span className="text-zinc-600">{g.whapi_id}</span>
                        );
                      return (
                        <tr key={g.id} className="hover:bg-zinc-900/50">
                          <td className="px-3 py-2 text-zinc-300">{label}</td>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={inc}
                              onChange={() => toggleInclude(g.id)}
                              disabled={!g.is_active}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={exc}
                              onChange={() => toggleExclude(g.id)}
                              disabled={!g.is_active}
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-zinc-500">
                            {match ? (
                              <span className="text-emerald-500">yes</span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="mb-2 text-sm font-semibold text-zinc-200">
                Template rotation pool
              </h2>
              <p className="mb-4 text-xs text-zinc-500">
                Checked templates form the pool. Each run picks the one with{" "}
                <strong className="text-zinc-400">lowest use_count</strong>, then oldest{" "}
                <strong className="text-zinc-400">last_used_at</strong>.
                Uses <code className="text-zinc-400">PROMO_LINK</code> env to replace{" "}
                <code className="text-zinc-400">{"{{link}}"}</code> if present.
              </p>
              <div className="grid gap-3">
                {templates.map((t) => {
                  const checked = (
                    localConfig.template_ids ?? []
                  ).includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 text-sm transition ${
                        checked
                          ? "border-blue-600/70 bg-blue-950/40"
                          : "border-zinc-800 hover:border-zinc-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTemplate(t.id)}
                        className="mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                            Used {t.use_count}x ·{" "}
                            {t.last_used_at
                              ? new Date(
                                  t.last_used_at
                                ).toLocaleDateString()
                              : "never"}
                          </span>
                        </div>
                        <p className="line-clamp-3 whitespace-pre-wrap text-zinc-300">
                          {t.content}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="mb-3 text-sm font-semibold text-zinc-200">
                Task history
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                Recent runs for this automation (sent / failed / status).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 text-zinc-500">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Started</th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      <th className="pb-2 pr-3 font-medium">Targeted</th>
                      <th className="pb-2 pr-3 font-medium">Sent</th>
                      <th className="pb-2 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {recentRuns.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-zinc-500">
                          No runs recorded yet.
                        </td>
                      </tr>
                    ) : (
                      recentRuns.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 pr-3 text-zinc-400">
                            {new Date(r.started_at).toLocaleString()}
                          </td>
                          <td className="py-2 pr-3 text-zinc-300">{r.status}</td>
                          <td className="py-2 pr-3">{r.groups_targeted}</td>
                          <td className="py-2 pr-3">{r.groups_sent}</td>
                          <td className="py-2 text-red-400/90">
                            {r.groups_failed}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
