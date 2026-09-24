"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { Plus, Trash2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type EnvEntry = {
  key: string;
  value: string;
};

export type EnvSuggestionGroup = {
  description?: string;
  text: string;
  title: string;
};

type ParsedSuggestionGroup = EnvSuggestionGroup & {
  entries: EnvEntry[];
};

export type EnvVarsFieldController = {
  activeEntryCount: number;
  activeKeys: Set<string>;
  addEntry: () => void;
  addSuggestedEntry: (suggestion: EnvEntry) => void;
  entries: EnvEntry[];
  envText: string;
  hasSuggestions: boolean;
  isDropActive: boolean;
  newKey: string;
  newValue: string;
  parsedSuggestionGroups: ParsedSuggestionGroup[];
  removeEntry: (index: number) => void;
  rootRef: RefObject<HTMLDivElement | null>;
  setIsDropActive: Dispatch<SetStateAction<boolean>>;
  setNewKey: Dispatch<SetStateAction<string>>;
  setNewValue: Dispatch<SetStateAction<string>>;
  updateEntry: (index: number, field: keyof EnvEntry, value: string) => void;
};

export function parseEnvEntries(text: string): EnvEntry[] {
  if (!text.trim()) return [];

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("=");

      if (separatorIndex < 0) {
        return { key: line, value: "" };
      }

      return {
        key: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1),
      };
    });
}

function entriesToText(entries: EnvEntry[]): string {
  return entries
    .filter((entry) => entry.key.trim())
    .map((entry) => `${entry.key.trim()}=${entry.value}`)
    .join("\n");
}

export function useEnvVarsFieldController({
  initialText,
  suggestionGroups = [],
}: {
  initialText: string;
  suggestionGroups?: EnvSuggestionGroup[];
}): EnvVarsFieldController {
  const rootRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<EnvEntry[]>(() => parseEnvEntries(initialText));
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isDropActive, setIsDropActive] = useState(false);
  const activeKeys = useMemo(
    () => new Set(entries.map((entry) => entry.key.trim()).filter(Boolean)),
    [entries],
  );
  const parsedSuggestionGroups = useMemo(
    () =>
      suggestionGroups
        .map((group) => {
          const uniqueEntries = new Map<string, EnvEntry>();

          for (const entry of parseEnvEntries(group.text)) {
            const trimmedKey = entry.key.trim();

            if (!trimmedKey || uniqueEntries.has(trimmedKey)) {
              continue;
            }

            uniqueEntries.set(trimmedKey, { key: trimmedKey, value: entry.value });
          }

          return {
            ...group,
            entries: [...uniqueEntries.values()],
          };
        })
        .filter((group) => group.entries.length > 0),
    [suggestionGroups],
  );

  useEffect(() => {
    const form = rootRef.current?.closest("form");

    if (!form) {
      return;
    }

    const handleReset = () => {
      queueMicrotask(() => {
        setEntries(parseEnvEntries(initialText));
        setNewKey("");
        setNewValue("");
      });
    };

    form.addEventListener("reset", handleReset);

    return () => {
      form.removeEventListener("reset", handleReset);
    };
  }, [initialText]);

  const addSuggestedEntry = useCallback((suggestion: EnvEntry) => {
    const trimmedKey = suggestion.key.trim();

    if (!trimmedKey) {
      return;
    }

    setEntries((previous) => {
      if (previous.some((entry) => entry.key.trim() === trimmedKey)) {
        return previous;
      }

      return [...previous, { key: trimmedKey, value: suggestion.value }];
    });
  }, []);

  const updateEntry = useCallback((index: number, field: keyof EnvEntry, value: string) => {
    setEntries((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [field]: value }
          : entry,
      ),
    );
  }, []);

  const removeEntry = useCallback((index: number) => {
    setEntries((previous) => previous.filter((_, entryIndex) => entryIndex !== index));
  }, []);

  const addEntry = useCallback(() => {
    const trimmedKey = newKey.trim();

    if (!trimmedKey) {
      return;
    }

    setEntries((previous) => {
      const existingIndex = previous.findIndex((entry) => entry.key === trimmedKey);

      if (existingIndex >= 0) {
        return previous.map((entry, entryIndex) =>
          entryIndex === existingIndex
            ? { key: trimmedKey, value: newValue }
            : entry,
        );
      }

      return [...previous, { key: trimmedKey, value: newValue }];
    });

    setNewKey("");
    setNewValue("");
  }, [newKey, newValue]);

  const envText = entriesToText(entries);
  const activeEntryCount = entries.filter((entry) => entry.key.trim()).length;
  const hasSuggestions = parsedSuggestionGroups.length > 0;

  return {
    activeEntryCount,
    activeKeys,
    addEntry,
    addSuggestedEntry,
    entries,
    envText,
    hasSuggestions,
    isDropActive,
    newKey,
    newValue,
    parsedSuggestionGroups,
    removeEntry,
    rootRef,
    setIsDropActive,
    setNewKey,
    setNewValue,
    updateEntry,
  };
}

export function EnvVarsEditorCard({
  controller,
  emptyMessage = "No environment variables loaded.",
  helperText,
  label = "Environment variables",
  name,
  placeholder = "KEY=value",
}: {
  controller: EnvVarsFieldController;
  emptyMessage?: string;
  helperText?: string;
  label?: string;
  name: string;
  placeholder?: string;
}) {
  const {
    activeEntryCount,
    addEntry,
    addSuggestedEntry,
    entries,
    envText,
    hasSuggestions,
    isDropActive,
    newKey,
    newValue,
    removeEntry,
    rootRef,
    setIsDropActive,
    setNewKey,
    setNewValue,
    updateEntry,
  } = controller;

  const inputClassName =
    "w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  return (
    <div
      ref={rootRef}
      className="min-w-0"
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDropActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();

        const nextTarget = event.relatedTarget;

        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return;
        }

        setIsDropActive(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropActive(false);

        const payload = event.dataTransfer.getData("application/x-tainer-env");

        if (!payload) {
          return;
        }

        try {
          const suggestion = JSON.parse(payload) as EnvEntry;
          addSuggestedEntry(suggestion);
        } catch {}
      }}
    >
      <Card
        className={`transition-colors ${
          isDropActive
            ? "border-emerald-500/60 bg-emerald-500/10"
            : "bg-[#111113]"
        }`}
      >
        <CardHeader className="border-b border-white/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{label}</CardTitle>
              {helperText ? (
                <CardDescription>{helperText}</CardDescription>
              ) : null}
            </div>
            <span className="rounded-full border border-white/5 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-500">
              {activeEntryCount} vars
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <input name={name} type="hidden" value={envText} />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/5 bg-zinc-950/40 px-3 py-2">
            <p className="text-[12px] text-zinc-500">
              {isDropActive
                ? "Drop a suggested variable here to add it."
                : "Edit current values or add new keys before create."}
            </p>
            {hasSuggestions ? (
              <span className="text-[11px] text-zinc-500">Drag from suggestions</span>
            ) : null}
          </div>

          {entries.length > 0 ? (
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div
                  key={`${entry.key}-${index}`}
                  className="grid gap-2 sm:grid-cols-[minmax(180px,0.85fr)_auto_minmax(0,1.15fr)_auto] sm:items-center"
                >
                  <input
                    className={`${inputClassName} min-w-0 font-mono`}
                    onChange={(event) => updateEntry(index, "key", event.target.value)}
                    placeholder="KEY"
                    value={entry.key}
                  />
                  <span className="hidden text-zinc-600 sm:block">=</span>
                  <input
                    className={`${inputClassName} min-w-0 font-mono`}
                    onChange={(event) => updateEntry(index, "value", event.target.value)}
                    placeholder="value"
                    value={entry.value}
                  />
                  <button
                    className="justify-self-start rounded-md p-2 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => removeEntry(index)}
                    title={`Remove ${entry.key || "variable"}`}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-white/5 bg-black/20 px-4 py-3">
              <p className="text-[13px] text-zinc-500">{emptyMessage}</p>
            </div>
          )}

          <div className="rounded-md border border-dashed border-white/10 bg-zinc-900/20 px-4 py-3">
            <p className="mb-3 text-[12px] font-medium text-zinc-500">Add custom variable</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(180px,0.85fr)_auto_minmax(0,1.15fr)_auto] sm:items-center">
              <input
                className={`${inputClassName} min-w-0 font-mono`}
                onChange={(event) => setNewKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addEntry();
                  }
                }}
                placeholder="KEY"
                value={newKey}
              />
              <span className="hidden text-zinc-600 sm:block">=</span>
              <input
                className={`${inputClassName} min-w-0 font-mono`}
                onChange={(event) => setNewValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addEntry();
                  }
                }}
                placeholder={placeholder}
                value={newValue}
              />
              <button
                className="justify-self-start rounded-md border border-white/10 bg-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
                disabled={!newKey.trim()}
                onClick={addEntry}
                title="Add variable"
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function EnvSuggestionsCard({
  controller,
  description = "Common container defaults and image-discovered keys you can drag or click into the active list.",
  title = "Suggested variables",
}: {
  controller: EnvVarsFieldController;
  description?: string;
  title?: string;
}) {
  const { activeKeys, addSuggestedEntry, hasSuggestions, parsedSuggestionGroups } = controller;

  if (!hasSuggestions) {
    return null;
  }

  return (
    <Card className="h-fit bg-[#111113]">
      <CardHeader className="border-b border-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <span className="text-[11px] text-zinc-500">No duplicates</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {parsedSuggestionGroups.map((group) => (
          <div key={group.title} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-zinc-300">{group.title}</p>
                {group.description ? (
                  <p className="text-[11px] leading-relaxed text-zinc-600">
                    {group.description}
                  </p>
                ) : null}
              </div>
              <span className="rounded-full border border-white/5 bg-zinc-950/80 px-2 py-0.5 text-[10px] text-zinc-500">
                {group.entries.length}
              </span>
            </div>

            <div className="space-y-2">
              {group.entries.map((entry) => {
                const isAdded = activeKeys.has(entry.key);

                return (
                  <button
                    key={`${group.title}:${entry.key}`}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      isAdded
                        ? "cursor-not-allowed border-white/5 bg-zinc-950/60 text-zinc-600"
                        : "border-white/10 bg-zinc-950/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900"
                    }`}
                    disabled={isAdded}
                    draggable={!isAdded}
                    onClick={() => addSuggestedEntry(entry)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        "application/x-tainer-env",
                        JSON.stringify(entry),
                      );
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 font-mono text-[12px]">{entry.key}</span>
                      <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        {isAdded ? "Added" : "Ready"}
                      </span>
                    </div>
                    <p
                      className="mt-1 truncate font-mono text-[11px] text-zinc-500"
                      title={entry.value || "(empty value)"}
                    >
                      {entry.value || "(empty value)"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function EnvVarsField({
  emptyMessage = "No environment variables loaded.",
  helperText,
  initialText,
  label = "Environment variables",
  name,
  placeholder = "KEY=value",
  suggestionGroups = [],
}: {
  emptyMessage?: string;
  helperText?: string;
  initialText: string;
  label?: string;
  name: string;
  placeholder?: string;
  suggestionGroups?: EnvSuggestionGroup[];
}) {
  const controller = useEnvVarsFieldController({ initialText, suggestionGroups });

  return (
    <div
      className={`grid gap-4 ${
        controller.hasSuggestions ? "xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]" : ""
      }`}
    >
      <EnvVarsEditorCard
        controller={controller}
        emptyMessage={emptyMessage}
        helperText={helperText}
        label={label}
        name={name}
        placeholder={placeholder}
      />
      <EnvSuggestionsCard controller={controller} />
    </div>
  );
}
