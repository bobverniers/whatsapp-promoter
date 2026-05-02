"use client";

import { useState } from "react";

export function TagsEditor({
  value,
  knownTags,
  onChange,
  className,
}: {
  value: string[];
  knownTags: string[];
  onChange: (tags: string[]) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const available = knownTags.filter((k) => !value.includes(k));

  function addTag(label: string) {
    const t = label.trim();
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    setDraft("");
  }

  function removeTag(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  return (
    <div className={className ?? ""}>
      {value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-0.5 rounded-md bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-100"
            >
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => removeTag(t)}
                className="text-zinc-500 hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <select
          className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) addTag(v);
            e.target.value = "";
          }}
        >
          <option value="">- - -</option>
          {available.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(draft);
            }
          }}
          placeholder="new tag…"
          className="min-w-[5rem] max-w-[7rem] flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => addTag(draft)}
          className="shrink-0 rounded-md bg-zinc-700 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-300 hover:bg-zinc-600"
        >
          Add
        </button>
      </div>
    </div>
  );
}
