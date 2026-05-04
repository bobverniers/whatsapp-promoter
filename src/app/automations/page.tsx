"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  interval_minutes: number;
  group_ids: string[] | null;
  template_ids: string[] | null;
  schedule_tz?: string | null;
  active_start_hour?: number | null;
  active_end_exclusive?: number | null;
  created_at: string;
  last_run_at: string | null;
  deleted_at: string | null;
};

type Group = {
  id: string;
  whapi_id: string;
  name: string | null;
  is_active: boolean;
  tags: string[] | null;
};

type Template = {
  id: string;
  content: string;
  use_count: number;
  last_used_at: string | null;
  tags: string[] | null;
};

type RunLog = {
  id: string;
  automation_id: string;
  automation_name: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  groups_targeted: number;
  groups_sent: number;
  groups_failed: number;
  error_summary: string | null;
  group_chat: string | null;
  message_sent: string | null;
};

type EditDraft = {
  id?: string;
  name: string;
  interval_minutes: number;
  group_ids: string[];
  template_ids: string[];
  enabled: boolean;
  schedule_tz: string;
  active_start_hour: number | null;
  active_end_exclusive: number | null;
};

const INTERVAL_OPTIONS = [5, 15, 30, 60, 180];

const COMMON_TIME_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
];

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

function emptyDraft(): EditDraft {
  return {
    name: "",
    interval_minutes: 15,
    group_ids: [],
    template_ids: [],
    enabled: false,
    schedule_tz: "UTC",
    active_start_hour: null,
    active_end_exclusive: null,
  };
}

function statusBadge(enabled: boolean) {
  return enabled
    ? "bg-emerald-900/50 text-emerald-300"
    : "bg-zinc-800 text-zinc-500";
}

function AutomationModal({
  title,
  draft,
  setDraft,
  groups,
  templates,
  onClose,
  onSave,
  saveLabel,
  allowDelete,
  onDelete,
}: {
  title: string;
  draft: EditDraft;
  setDraft: (next: EditDraft) => void;
  groups: Group[];
  templates: Template[];
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  allowDelete?: boolean;
  onDelete?: () => void;
}) {
  const [groupSearch, setGroupSearch] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      `${g.name ?? ""} ${g.whapi_id}`.toLowerCase().includes(q)
    );
  }, [groupSearch, groups]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.content.toLowerCase().includes(q));
  }, [templateSearch, templates]);

  function toggleGroup(id: string) {
    const s = new Set(draft.group_ids);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setDraft({ ...draft, group_ids: [...s] });
  }

  function toggleTemplate(id: string) {
    const s = new Set(draft.template_ids);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setDraft({ ...draft, template_ids: [...s] });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="h-[90vh] w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Close
          </button>
        </div>

        <div className="grid h-[calc(90vh-64px)] grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-2">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">
              Automation settings
            </h3>
            <label className="mb-2 block text-xs text-zinc-500">Name</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mb-4 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />

            <label className="mb-2 block text-xs text-zinc-500">
              Interval
            </label>
            <select
              value={draft.interval_minutes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  interval_minutes: Number(e.target.value) || 15,
                })
              }
              className="mb-4 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {INTERVAL_OPTIONS.map((mins) => (
                <option key={mins} value={mins}>
                  Every {mins} minute{mins === 1 ? "" : "s"}
                </option>
              ))}
            </select>

            <label className="mb-2 block text-xs text-zinc-500">
              Local timezone (IANA)
            </label>
            <input
              list="automations_tz_list"
              value={draft.schedule_tz}
              onChange={(e) =>
                setDraft({ ...draft, schedule_tz: e.target.value.trim() })
              }
              placeholder="UTC"
              className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <datalist id="automations_tz_list">
              {COMMON_TIME_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>

            <label className="mb-2 flex items-start gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={
                  draft.active_start_hour != null ||
                  draft.active_end_exclusive != null
                }
                onChange={(e) => {
                  if (e.target.checked) {
                    setDraft({
                      ...draft,
                      active_start_hour: 9,
                      active_end_exclusive: 22,
                    });
                  } else {
                    setDraft({
                      ...draft,
                      active_start_hour: null,
                      active_end_exclusive: null,
                    });
                  }
                }}
              />
              <span className="text-xs leading-snug text-zinc-400">
                <span className="font-medium text-zinc-300">
                  Restrict to local hours
                </span>
                <span className="block text-[11px] text-zinc-500">
                  When enabled, sends only while the clock hour at the timezone
                  is from start through hour before “end” (exclusive). Example:
                  9→22 sends 09:00–21:59.
                </span>
              </span>
            </label>
            {(draft.active_start_hour != null ||
              draft.active_end_exclusive != null) && (
              <div className="mb-4 flex gap-4">
                <div className="flex-1">
                  <label className="mb-2 block text-xs text-zinc-500">
                    Start hour (0–23)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={draft.active_start_hour ?? 9}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        active_start_hour:
                          Number.parseInt(e.target.value, 10) ?? 9,
                      })
                    }
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-2 block text-xs text-zinc-500">
                    End hour (exclusive 1–24)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={draft.active_end_exclusive ?? 22}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        active_end_exclusive:
                          Number.parseInt(e.target.value, 10) ?? 22,
                      })
                    }
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            <label className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Running
            </label>

            <div className="text-xs text-zinc-500">
              Selected groups: <span className="text-zinc-300">{draft.group_ids.length}</span>
              {" · "}
              Selected templates:{" "}
              <span className="text-zinc-300">{draft.template_ids.length}</span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSave}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                {saveLabel}
              </button>
              {allowDelete && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded-lg bg-red-900/60 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/80"
                >
                  Delete automation
                </button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">
              Groups (manual selection)
            </h3>
            <input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Search groups..."
              className="mb-3 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <div className="max-h-60 overflow-y-auto rounded-md border border-zinc-800">
              {filteredGroups.map((g) => {
                const checked = draft.group_ids.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center justify-between border-b border-zinc-800 px-3 py-2 text-sm last:border-0 hover:bg-zinc-900/50"
                  >
                    <span className="min-w-0 truncate pr-2">
                      {g.name ?? g.whapi_id}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(g.id)}
                    />
                  </label>
                );
              })}
              {filteredGroups.length === 0 && (
                <p className="p-4 text-xs text-zinc-500">No groups found.</p>
              )}
            </div>

            <h3 className="mb-3 mt-6 text-sm font-semibold text-zinc-200">
              Templates (rotation pool)
            </h3>
            <input
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="Search templates..."
              className="mb-3 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <div className="max-h-60 overflow-y-auto rounded-md border border-zinc-800">
              {filteredTemplates.map((t) => {
                const checked = draft.template_ids.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-start justify-between gap-3 border-b border-zinc-800 px-3 py-2 text-sm last:border-0 hover:bg-zinc-900/50"
                  >
                    <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap text-zinc-300">
                      {t.content}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTemplate(t.id)}
                    />
                  </label>
                );
              })}
              {filteredTemplates.length === 0 && (
                <p className="p-4 text-xs text-zinc-500">No templates found.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function AutomationsPage() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft());
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      if (sessionStorage.getItem("admin_pw")) setAuthed(true);
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    const res = await api("/api/automations");
    const data = await res.json();
    if (!res.ok) {
      setBanner(data.details ? `${data.error}: ${data.details}` : data.error);
      setLoading(false);
      return;
    }
    setAutomations(data.automations ?? []);
    setGroups(data.groups ?? []);
    setTemplates(data.templates ?? []);
    setLogs(data.logs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authed) return;
    queueMicrotask(() => void fetchData());
  }, [authed, fetchData]);

  const activeAutomation = useMemo(
    () => automations.find((a) => a.id === activeId) ?? null,
    [automations, activeId]
  );

  function openCreate() {
    setDraft(emptyDraft());
    setCreateOpen(true);
  }

  function openDetails(a: Automation) {
    setActiveId(a.id);
    setDraft({
      id: a.id,
      name: a.name,
      interval_minutes: a.interval_minutes || 15,
      group_ids: a.group_ids ?? [],
      template_ids: a.template_ids ?? [],
      enabled: a.enabled,
      schedule_tz: a.schedule_tz?.trim()
        ? a.schedule_tz.trim()
        : "UTC",
      active_start_hour: a.active_start_hour ?? null,
      active_end_exclusive: a.active_end_exclusive ?? null,
    });
    setDetailsOpen(true);
  }

  async function createAutomation() {
    const res = await api("/api/automations", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner(data.details ? `${data.error}: ${data.details}` : data.error);
      return;
    }
    setCreateOpen(false);
    await fetchData();
  }

  async function saveDetails() {
    if (!draft.id) return;
    const res = await api("/api/automations", {
      method: "PATCH",
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner(data.details ? `${data.error}: ${data.details}` : data.error);
      return;
    }
    setDetailsOpen(false);
    await fetchData();
  }

  async function togglePauseResume(a: Automation) {
    const res = await api("/api/automations", {
      method: "PATCH",
      body: JSON.stringify({ id: a.id, enabled: !a.enabled }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner(data.details ? `${data.error}: ${data.details}` : data.error);
      return;
    }
    await fetchData();
  }

  async function deleteAutomation() {
    if (!draft.id) return;
    if (!confirm("Delete this automation? It will stop scheduling.")) return;
    const res = await api("/api/automations", {
      method: "DELETE",
      body: JSON.stringify({ id: draft.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner(data.details ? `${data.error}: ${data.details}` : data.error);
      return;
    }
    setDetailsOpen(false);
    await fetchData();
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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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
        {banner && (
          <div className="mb-4 rounded-lg border border-red-900/50 bg-red-900/20 px-4 py-2.5 text-sm text-red-300">
            {banner}
          </div>
        )}

        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              Live Automations
            </h2>
          </div>

          {loading ? (
            <p className="py-10 text-center text-zinc-500">Loading automations...</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-900/70 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Automation name</th>
                    <th className="px-4 py-3 font-medium">Created on</th>
                    <th className="px-4 py-3 font-medium">Last run</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">View details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {automations.map((a) => (
                    <tr key={a.id} className="hover:bg-zinc-900/40">
                      <td className="px-4 py-3 text-zinc-200">{a.name}</td>
                      <td className="px-4 py-3 text-zinc-400">
                        {new Date(a.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {a.last_run_at
                          ? new Date(a.last_run_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(a.enabled)}`}
                        >
                          {a.enabled ? "Automation running" : "Automation paused"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDetails(a)}
                          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))}
                  {automations.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-zinc-500">
                        No automations yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Add automation
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Logs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 text-zinc-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Automation</th>
                  <th className="pb-2 pr-3 font-medium">Started</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Targeted</th>
                  <th className="pb-2 pr-3 font-medium">Sent</th>
                  <th className="pb-2 pr-3 font-medium">Failed</th>
                  <th className="pb-2 pr-3 font-medium">Group chat</th>
                  <th className="pb-2 pr-3 font-medium">Message sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {logs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 text-zinc-300">
                      {r.automation_name ?? r.automation_id}
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">
                      {new Date(r.started_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">{r.status}</td>
                    <td className="py-2 pr-3">{r.groups_targeted}</td>
                    <td className="py-2 pr-3">{r.groups_sent}</td>
                    <td className="py-2 pr-3 text-red-400/90">
                      {r.groups_failed}
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      <span
                        className="line-clamp-1 cursor-help rounded px-1 transition hover:line-clamp-none hover:bg-zinc-900/70"
                      >
                        {r.group_chat ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      <span
                        className="line-clamp-2 cursor-help whitespace-pre-wrap rounded px-1 transition hover:line-clamp-none hover:bg-zinc-900/70"
                      >
                        {r.message_sent ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-zinc-500">
                      No logs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {createOpen && (
        <AutomationModal
          title="Add automation"
          draft={draft}
          setDraft={setDraft}
          groups={groups}
          templates={templates}
          onClose={() => setCreateOpen(false)}
          onSave={createAutomation}
          saveLabel="Create automation"
        />
      )}

      {detailsOpen && activeAutomation && (
        <AutomationModal
          title="Automation details"
          draft={draft}
          setDraft={setDraft}
          groups={groups}
          templates={templates}
          onClose={() => setDetailsOpen(false)}
          onSave={saveDetails}
          saveLabel="Save changes"
          allowDelete
          onDelete={deleteAutomation}
        />
      )}

      {detailsOpen && activeAutomation && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50">
          <button
            type="button"
            onClick={() => togglePauseResume(activeAutomation)}
            className={`pointer-events-auto rounded-lg px-3 py-2 text-xs font-medium ${
              activeAutomation.enabled
                ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                : "bg-emerald-700 text-emerald-100 hover:bg-emerald-600"
            }`}
          >
            {activeAutomation.enabled ? "Pause automation" : "Resume automation"}
          </button>
        </div>
      )}
    </div>
  );
}
