"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Group {
  id: string;
  whapi_id: string;
  name: string | null;
  tag: string | null;
  joined_at: string;
  last_promoted_at: string | null;
  is_active: boolean;
  status_notes: string | null;
}

interface Link {
  id: string;
  tag: string;
  current_url: string;
  updated_at: string;
}

interface Template {
  id: string;
  content: string;
  tag: string | null;
  use_count: number;
  last_used_at: string | null;
}

// ─── API helper ──────────────────────────────────────────────────────────────

function api(path: string, opts: RequestInit = {}) {
  const password = sessionStorage.getItem("admin_pw") ?? "";
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": password,
      ...(opts.headers ?? {}),
    },
  });
}

// ─── Reusable tag input (select existing or type new) ────────────────────────

function TagInput({
  value,
  knownTags,
  onChange,
  className,
}: {
  value: string;
  knownTags: string[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const [custom, setCustom] = useState(false);

  if (custom) {
    return (
      <div className={`flex gap-1 ${className ?? ""}`}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a tag..."
          autoFocus
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => {
            setCustom(false);
            onChange("");
          }}
          className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className={`flex gap-1 ${className ?? ""}`}>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__new__") {
            setCustom(true);
            onChange("");
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-500"
      >
        <option value="">—</option>
        {knownTags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value="__new__">+ New tag...</option>
      </select>
    </div>
  );
}

// ─── Password Gate ───────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json();
    if (data.ok) {
      sessionStorage.setItem("admin_pw", pw);
      onLogin();
    } else {
      setError(true);
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8"
      >
        <h1 className="mb-6 text-xl font-semibold text-zinc-100">
          Promoter Admin
        </h1>
        <input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
        />
        {error && (
          <p className="mb-3 text-sm text-red-400">Wrong password</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Log in"}
        </button>
      </form>
    </div>
  );
}

// ─── Groups Tab ──────────────────────────────────────────────────────────────

type Banner = { kind: "success" | "info" | "error"; text: string };

function GroupsTab() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [filter, setFilter] = useState("all");
  const [testSendingId, setTestSendingId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState("");

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const res = await api("/api/groups");
    if (res.ok) setGroups(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const knownTags = useMemo(() => {
    const tags = new Set<string>();
    for (const g of groups) {
      if (g.tag) tags.add(g.tag);
    }
    return Array.from(tags).sort();
  }, [groups]);

  async function handleSync() {
    setSyncing(true);
    await api("/api/sync-groups", { method: "POST" });
    await fetchGroups();
    setSyncing(false);
  }

  function showBanner(b: Banner) {
    setBanner(b);
    setTimeout(() => {
      setBanner((prev) => (prev === b ? null : prev));
    }, 6000);
  }

  async function updateGroup(id: string, updates: Partial<Group>) {
    const res = await api("/api/groups", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    });
    if (res.ok) {
      const updated = await res.json();
      setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
    }
  }

  async function handleTestSend(g: Group) {
    if (!testMessage.trim()) {
      showBanner({
        kind: "info",
        text: "Enter a test message first",
      });
      return;
    }

    const label = g.name || g.whapi_id;
    const tagLine = g.tag ? `Tag: ${g.tag}` : "Tag: none";
    if (
      !confirm(
        `Send ONE test WhatsApp message to this group?\n\n${label}\n${tagLine}\n\nMessage preview:\n${testMessage}\n\nThis bypasses warmup/cooldown. Continue?`
      )
    ) {
      return;
    }

    const body = { group_id: g.id, message: testMessage.trim() };

    setTestSendingId(g.id);
    setBanner(null);
    try {
      const res = await api("/api/promote-test", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner({
          kind: "error",
          text: data.details
            ? `${data.error}: ${data.details}`
            : data.error ?? "Test send failed",
        });
      } else if (data.sent) {
        const name = data.group?.name ?? data.group?.whapi_id ?? "group";
        showBanner({
          kind: "success",
          text: `[Test] Sent to ${name}${data.group?.tag ? ` (${data.group.tag})` : ""}`,
        });
        await fetchGroups();
      } else if (data.skipped) {
        showBanner({ kind: "info", text: `Skipped: ${data.reason}` });
      } else {
        showBanner({ kind: "info", text: "No action taken" });
      }
    } catch (err) {
      showBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setTestSendingId(null);
    }
  }

  const filtered = groups.filter((g) => {
    if (filter === "untagged") return !g.tag;
    if (filter !== "all") return g.tag === filter;
    return true;
  });

  const untaggedCount = groups.filter((g) => !g.tag).length;
  const tagCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of groups) {
      if (g.tag) map[g.tag] = (map[g.tag] || 0) + 1;
    }
    return map;
  }, [groups]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filter === "all"
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All <span className="opacity-60">({groups.length})</span>
          </button>
          <button
            onClick={() => setFilter("untagged")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filter === "untagged"
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Untagged <span className="opacity-60">({untaggedCount})</span>
          </button>
          {knownTags.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === t
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t} <span className="opacity-60">({tagCounts[t] || 0})</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-amber-800/60 bg-amber-950/20 p-3">
        <label className="mb-2 block text-sm text-amber-200">
          Test message text (used by row-level Test buttons)
        </label>
        <textarea
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          rows={3}
          placeholder="Write the exact message to send to one selected group..."
          className="w-full rounded-md border border-amber-800/50 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-600"
        />
      </div>

      {banner && (
        <div
          className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${
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

      {loading ? (
        <p className="py-8 text-center text-zinc-500">Loading groups...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/50 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Tag</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Last Promoted</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Test</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((g) => (
                <tr key={g.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3 text-zinc-200">
                    {g.name || (
                      <span className="text-zinc-600">{g.whapi_id}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TagInput
                      value={g.tag ?? ""}
                      knownTags={knownTags}
                      onChange={(v) => updateGroup(g.id, { tag: v } as Partial<Group>)}
                      className="w-36"
                    />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {new Date(g.joined_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {g.last_promoted_at
                      ? new Date(g.last_promoted_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        updateGroup(g.id, { is_active: !g.is_active })
                      }
                      className={`rounded-full px-3 py-0.5 text-xs font-medium ${
                        g.is_active
                          ? "bg-emerald-900/50 text-emerald-400"
                          : "bg-red-900/50 text-red-400"
                      }`}
                    >
                      {g.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleTestSend(g)}
                      disabled={testSendingId !== null}
                      className="rounded-lg bg-amber-700/80 px-2.5 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-600 disabled:opacity-50"
                    >
                      {testSendingId === g.id ? "Sending..." : "Test"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="py-8 text-center text-zinc-500">
              No groups match this filter
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Links Tab ───────────────────────────────────────────────────────────────

function LinksTab() {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const res = await api("/api/links");
    if (res.ok) setLinks(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTag || !newUrl) return;
    const res = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ tag: newTag, current_url: newUrl }),
    });
    if (res.ok) {
      setNewTag("");
      setNewUrl("");
      fetchLinks();
    }
  }

  async function handleSave(id: string) {
    const res = await api("/api/links", {
      method: "PATCH",
      body: JSON.stringify({ id, current_url: editUrl }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchLinks();
    }
  }

  return (
    <div>
      <form
        onSubmit={handleAdd}
        className="mb-6 flex flex-wrap gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
      >
        <input
          placeholder="Tag name"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          className="w-36 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-blue-500"
        />
        <input
          placeholder="Community invite URL"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          Add Link
        </button>
      </form>

      {loading ? (
        <p className="py-8 text-center text-zinc-500">Loading links...</p>
      ) : links.length === 0 ? (
        <p className="py-8 text-center text-zinc-500">
          No community links yet. Add one above.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-md bg-blue-600/20 px-2.5 py-0.5 text-sm font-semibold text-blue-400">
                  {link.tag}
                </span>
                <span className="text-xs text-zinc-500">
                  Updated {new Date(link.updated_at).toLocaleDateString()}
                </span>
              </div>
              {editingId === link.id ? (
                <div className="flex gap-2">
                  <input
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => handleSave(link.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-lg bg-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-zinc-300">
                    {link.current_url}
                  </p>
                  <button
                    onClick={() => {
                      setEditingId(link.id);
                      setEditUrl(link.current_url);
                    }}
                    className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Templates Tab ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [newTag, setNewTag] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTag, setEditTag] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [tRes, gRes] = await Promise.all([
      api("/api/templates"),
      api("/api/groups"),
    ]);
    if (tRes.ok) setTemplates(await tRes.json());
    if (gRes.ok) setGroups(await gRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const knownTags = useMemo(() => {
    const tags = new Set<string>();
    for (const g of groups) {
      if (g.tag) tags.add(g.tag);
    }
    for (const t of templates) {
      if (t.tag) tags.add(t.tag);
    }
    return Array.from(tags).sort();
  }, [groups, templates]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent) return;
    const res = await api("/api/templates", {
      method: "POST",
      body: JSON.stringify({ content: newContent, tag: newTag || null }),
    });
    if (res.ok) {
      setNewContent("");
      setNewTag("");
      fetchData();
    }
  }

  async function handleSave(id: string) {
    const res = await api("/api/templates", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        content: editContent,
        tag: editTag || null,
      }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchData();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    const res = await api("/api/templates", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    if (res.ok) fetchData();
  }

  return (
    <div>
      <form
        onSubmit={handleAdd}
        className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
      >
        <textarea
          placeholder='Write a message template... Use {{link}} for the invite link, e.g. "Hey! Looking for housing in Amsterdam? Join us: {{link}}"'
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={3}
          className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-blue-500"
        />
        <div className="flex gap-3">
          <TagInput
            value={newTag}
            knownTags={knownTags}
            onChange={setNewTag}
            className="w-48"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Add Template
          </button>
        </div>
      </form>

      {loading ? (
        <p className="py-8 text-center text-zinc-500">Loading templates...</p>
      ) : templates.length === 0 ? (
        <p className="py-8 text-center text-zinc-500">
          No templates yet. Add one above.
        </p>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
            >
              {editingId === t.id ? (
                <div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
                  />
                  <div className="flex gap-2">
                    <TagInput
                      value={editTag}
                      knownTags={knownTags}
                      onChange={setEditTag}
                      className="w-48"
                    />
                    <button
                      onClick={() => handleSave(t.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-lg bg-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                      {t.content}
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => {
                          setEditingId(t.id);
                          setEditContent(t.content);
                          setEditTag(t.tag ?? "");
                        }}
                        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="rounded-lg bg-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/80"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-zinc-500">
                    {t.tag && (
                      <span className="rounded-md bg-blue-600/20 px-2 py-0.5 font-medium text-blue-400">
                        {t.tag}
                      </span>
                    )}
                    <span>Used {t.use_count}x</span>
                    {t.last_used_at && (
                      <span>
                        Last used{" "}
                        {new Date(t.last_used_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function Home() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("admin_pw")) {
      setAuthed(true);
    }
  }, []);

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold">Promoter Admin</h1>
          <button
            onClick={() => {
              sessionStorage.removeItem("admin_pw");
              setAuthed(false);
            }}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <GroupsTab />
      </div>
    </div>
  );
}
