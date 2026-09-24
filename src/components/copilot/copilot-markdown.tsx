"use client";

import React from "react";

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; text: string; lang: string | null }
  | { kind: "hr" };

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || null;
      const start = i + 1;
      let end = start;
      while (end < lines.length && !lines[end].startsWith("```")) end++;
      out.push({ kind: "code", lang, text: lines.slice(start, end).join("\n") });
      i = end + 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (h) {
      out.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(```|#{1,3}\s|[-*]\s|\d+\.\s|---+\s*$)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push({ kind: "p", text: para.join(" ") });
  }

  return out;
}

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

// Alternation order is priority: code first, so backticks inside bold stay literal.
const INLINE_RX =
  /(`[^`\n]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/;

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;
  while (rest.length) {
    const m = rest.match(INLINE_RX);
    if (!m || m.index === undefined) {
      tokens.push({ kind: "text", text: rest });
      break;
    }
    if (m.index > 0) {
      tokens.push({ kind: "text", text: rest.slice(0, m.index) });
    }
    const match = m[0];
    if (match.startsWith("`")) {
      tokens.push({ kind: "code", text: match.slice(1, -1) });
    } else if (match.startsWith("[")) {
      tokens.push({ kind: "link", text: m[3], href: m[4] });
    } else if (match.startsWith("**")) {
      tokens.push({ kind: "bold", text: match.slice(2, -2) });
    } else if (match.startsWith("*") || match.startsWith("_")) {
      tokens.push({ kind: "italic", text: match.slice(1, -1) });
    }
    rest = rest.slice(m.index + match.length);
  }
  return tokens;
}

function Inline({ text }: { text: string }) {
  const tokens = tokenizeInline(text);
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "text":
            return <React.Fragment key={i}>{t.text}</React.Fragment>;
          case "bold":
            return (
              <strong key={i} className="font-semibold text-white">
                {t.text}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="italic text-zinc-100">
                {t.text}
              </em>
            );
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-white/[0.06] border border-white/[0.04] px-1 py-px text-[11.5px] font-mono text-zinc-100"
              >
                {t.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={t.href}
                target={t.href.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
                className="text-sky-300 underline-offset-2 hover:underline hover:text-sky-200"
              >
                {t.text}
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-[13px] text-zinc-200 leading-relaxed">
          <Inline text={block.text} />
        </p>
      );
    case "h": {
      const cls =
        block.level === 1
          ? "text-[15px] font-semibold text-white mt-1"
          : block.level === 2
            ? "text-[14px] font-semibold text-white mt-1"
            : "text-[12.5px] font-semibold text-zinc-100 mt-0.5";
      const Tag = `h${block.level}` as keyof React.JSX.IntrinsicElements;
      return (
        <Tag className={cls}>
          <Inline text={block.text} />
        </Tag>
      );
    }
    case "ul":
      return (
        <ul className="list-disc list-outside pl-4 space-y-0.5 text-[13px] text-zinc-200 marker:text-zinc-600">
          {block.items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal list-outside pl-4 space-y-0.5 text-[13px] text-zinc-200 marker:text-zinc-500">
          {block.items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              <Inline text={item} />
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="rounded-md border border-white/[0.06] bg-black/40 px-3 py-2 text-[11.5px] font-mono text-zinc-200 overflow-auto">
          {block.text}
        </pre>
      );
    case "hr":
      return <hr className="my-1 border-white/[0.06]" />;
  }
}

export function CopilotMarkdown({ text }: { text: string }) {
  if (!text) return null;
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
