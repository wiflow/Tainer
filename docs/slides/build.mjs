// Build: npm install --no-save pptxgenjs && node docs/slides/build.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import pptxgen from "pptxgenjs";
import React from "react";
import ReactDOMServer from "react-dom/server";
import sharp from "sharp";
import { FaArrowRight } from "react-icons/fa";
import {
  FiServer, FiBox, FiDatabase, FiMap, FiUsers, FiSettings,
  FiShield, FiTerminal, FiPlayCircle, FiPackage, FiLayers,
  FiClock, FiCheck, FiHardDrive, FiChevronRight, FiZap,
} from "react-icons/fi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const C = {
  bg:        "09090B",          // main background (zinc-950)
  surface:   "111113",          // card background (#111113)
  surface2:  "111113",          // same surface color for consistency
  border:    "1A1A1A",          // ≈ border-white/5
  borderHi:  "262626",          // ≈ border-white/10
  text:      "FFFFFF",          // primary
  zinc200:   "FFFFFF",
  zinc300:   "D4D4D8",
  zinc400:   "A1A1AA",          // text-zinc-400
  zinc500:   "A1A1AA",          // brightened for contrast
  zinc600:   "71717A",          // text-zinc-500
  zinc700:   "52525B",
  zinc800:   "3F3F46",
  emerald:   "10B981",
  rose:      "F43F5E",
  amber:     "F59E0B",
};

const FONT_TITLE = "Outfit";
const FONT_BODY  = "Plus Jakarta Sans";

const LOGO_PATH = path.resolve(__dirname, "logo.png");

async function icon(Icon, colorHex = C.text, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Icon, { color: "#" + colorHex, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function paintBackground(slide) {
  slide.background = { color: C.bg };
}

function addGlow(slide, opts = {}) {
  const {
    x = -1.6, y = -1.2, w = 6.5, h = 6.5, transparency = 92,
  } = opts;
  slide.addShape("ellipse", {
    x, y, w, h,
    fill: { color: "FFFFFF", transparency },
    line: { color: "FFFFFF", width: 0 },
  });
}

function addLogo(slide, { x = 0.5, y = 0.45, w = 0.32, labelSize = 13 } = {}) {
  slide.addImage({ path: LOGO_PATH, x, y, w, h: w });
  if (labelSize) {
    slide.addText("Tainer", {
      x: x + w + 0.1, y: y - 0.005, w: 2, h: w + 0.01,
      fontFace: FONT_TITLE, fontSize: labelSize, bold: true, color: C.text,
      margin: 0, valign: "middle", charSpacing: -1,
    });
  }
}

function addTopBar(slide, rightLabel) {
  addLogo(slide);
  if (rightLabel) {
    slide.addText(rightLabel, {
      x: 7.5, y: 0.5, w: 2, h: 0.28,
      fontFace: FONT_BODY, fontSize: 10, color: C.zinc600,
      align: "right", charSpacing: 6, margin: 0, valign: "middle", bold: true,
    });
  }
}

function addFooter(slide, pageLabel) {
  slide.addShape("rect", {
    x: 0.5, y: 5.38, w: 9, h: 0.008,
    fill: { color: C.border }, line: { color: C.border, width: 0 },
  });
  slide.addText("PROXMOX CONTAINER MANAGEMENT", {
    x: 0.5, y: 5.43, w: 5, h: 0.22,
    fontFace: FONT_BODY, fontSize: 8, bold: true, color: C.zinc600,
    charSpacing: 10, margin: 0, valign: "middle",
  });
  slide.addText(pageLabel, {
    x: 7.5, y: 5.43, w: 2, h: 0.22,
    fontFace: FONT_BODY, fontSize: 8, color: C.zinc600, bold: true,
    align: "right", charSpacing: 6, margin: 0, valign: "middle",
  });
}

function addCard(slide, { x, y, w, h, fill = C.surface, radius = 0.14 }) {
  slide.addShape("roundRect", {
    x: x - 0.008, y: y - 0.008, w: w + 0.016, h: h + 0.016, rectRadius: radius + 0.002,
    fill: { color: C.border }, line: { color: C.border, width: 0 },
  });
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: radius,
    fill: { color: fill }, line: { color: fill, width: 0 },
  });
}

function addChip(slide, x, y, w, h, label, {
  fill = C.surface2, textColor = C.zinc400,
} = {}) {
  slide.addShape("roundRect", {
    x: x - 0.008, y: y - 0.008, w: w + 0.016, h: h + 0.016, rectRadius: 0.1,
    fill: { color: C.border }, line: { color: C.border, width: 0 },
  });
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.095,
    fill: { color: fill }, line: { color: fill, width: 0 },
  });
  slide.addText(label, {
    x, y, w, h,
    fontFace: FONT_BODY, fontSize: 8, bold: true, color: textColor,
    align: "center", valign: "middle", charSpacing: 8, margin: 0,
  });
}

function addStatusDot(slide, x, y, color, d = 0.1) {
  slide.addShape("ellipse", {
    x, y, w: d, h: d,
    fill: { color }, line: { color, width: 0 },
  });
}

async function build() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "Tainer";
  pres.title  = "Tainer: Tutorial Series";

  const Ic = {
    server:   await icon(FiServer,    C.zinc300),
    box:      await icon(FiBox,       C.zinc300),
    db:       await icon(FiDatabase,  C.zinc300),
    map:      await icon(FiMap,       C.zinc300),
    users:    await icon(FiUsers,     C.zinc300),
    settings: await icon(FiSettings,  C.zinc300),
    shield:   await icon(FiShield,    C.zinc300),
    term:     await icon(FiTerminal,  C.zinc300),
    play:     await icon(FiPlayCircle,C.zinc300),
    package:  await icon(FiPackage,   C.zinc300),
    layers:   await icon(FiLayers,    C.zinc300),
    clock:    await icon(FiClock,     C.zinc300),
    check:    await icon(FiCheck,     C.zinc400),
    drive:    await icon(FiHardDrive, C.zinc300),
    chev:     await icon(FiChevronRight, C.zinc500),
    arrow:    await icon(FaArrowRight,   C.zinc400),
    zap:      await icon(FiZap,       C.zinc300),
  };

  {
    const s = pres.addSlide();
    paintBackground(s);
    addGlow(s, { x: -1.8, y: -2.0, w: 7, h: 7, transparency: 93 });
    addGlow(s, { x: 5.5,  y: 3.0,  w: 6, h: 6, transparency: 94 });

    const logoW = 0.55;
    s.addImage({ path: LOGO_PATH, x: 0.5, y: 0.5, w: logoW, h: logoW });
    s.addText("Tainer", {
      x: 0.5 + logoW + 0.14, y: 0.5, w: 3, h: logoW,
      fontFace: FONT_TITLE, fontSize: 22, bold: true, color: C.text,
      valign: "middle", margin: 0, charSpacing: -1,
    });
    s.addText("PROXMOX CONTAINER MANAGEMENT", {
      x: 7.0, y: 0.6, w: 2.5, h: 0.3,
      fontFace: FONT_BODY, fontSize: 8.5, bold: true, color: C.zinc600,
      align: "right", charSpacing: 10, valign: "middle", margin: 0,
    });

    s.addText("Tutorial series.", {
      x: 0.5, y: 1.85, w: 9, h: 1.0,
      fontFace: FONT_TITLE, fontSize: 76, bold: true, color: C.text,
      charSpacing: -2, margin: 0,
    });
    s.addText("Everything you need to run Tainer,", {
      x: 0.5, y: 2.95, w: 9, h: 0.55,
      fontFace: FONT_TITLE, fontSize: 26, color: C.zinc400,
      charSpacing: -0.5, margin: 0,
    });
    s.addText("in under an hour of video.", {
      x: 0.5, y: 3.42, w: 9, h: 0.55,
      fontFace: FONT_TITLE, fontSize: 26, color: C.zinc500, italic: true,
      charSpacing: -0.5, margin: 0,
    });

    addStatusDot(s, 0.52, 4.55, C.emerald, 0.09);
    s.addText("10 episodes", {
      x: 0.72, y: 4.44, w: 1.6, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: C.zinc400,
      valign: "middle", margin: 0, bold: true,
    });
    s.addText("·", { x: 2.2, y: 4.44, w: 0.1, h: 0.3, color: C.zinc700, valign: "middle", margin: 0 });
    s.addText("2-5 minutes each", {
      x: 2.35, y: 4.44, w: 2.0, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: C.zinc500,
      valign: "middle", margin: 0,
    });
    s.addText("·", { x: 4.25, y: 4.44, w: 0.1, h: 0.3, color: C.zinc700, valign: "middle", margin: 0 });
    s.addText("self-service Proxmox", {
      x: 4.4, y: 4.44, w: 3.0, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: C.zinc500,
      valign: "middle", margin: 0,
    });

    addFooter(s, "01 / 10");
  }

  {
    const s = pres.addSlide();
    paintBackground(s);
    addGlow(s, { x: 6.0, y: -2.0, w: 6, h: 6, transparency: 94 });
    addTopBar(s, "OVERVIEW");

    s.addText("What is Tainer?", {
      x: 0.5, y: 1.1, w: 9, h: 0.75,
      fontFace: FONT_TITLE, fontSize: 44, bold: true, color: C.text,
      charSpacing: -1.5, margin: 0,
    });
    s.addText("A curated catalog, one-click LXC & VM deployments, and a live view across every Proxmox site you run.", {
      x: 0.5, y: 1.95, w: 9, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, color: C.zinc400, margin: 0,
    });

    const cards = [
      { ic: Ic.box,   t: "Template Catalog", b: "Launch LXC and VMs from a curated library, or bring your own." },
      { ic: Ic.package, t: "Docker & OCI",   b: "Pull from Docker Hub, Gitea, or any OCI registry. Works offline." },
      { ic: Ic.db,    t: "Backup Policies",  b: "Scheduled snapshots, tag-scoped retention, one-click restore." },
      { ic: Ic.map,   t: "Overview Map",     b: "Every site on one canvas. CPU, RAM and storage at a glance." },
    ];

    const gx = 0.5, gy = 2.75, gap = 0.2;
    const cw = (10 - gx * 2 - gap * 3) / 4;
    const ch = 2.3;
    cards.forEach((c, i) => {
      const x = gx + i * (cw + gap);
      addCard(s, { x, y: gy, w: cw, h: ch });
      s.addImage({ data: c.ic, x: x + 0.35, y: gy + 0.38, w: 0.34, h: 0.34 });
      s.addText(c.t, {
        x: x + 0.35, y: gy + 0.88, w: cw - 0.7, h: 0.38,
        fontFace: FONT_TITLE, fontSize: 15, bold: true, color: C.text,
        charSpacing: -0.3, margin: 0,
      });
      s.addText(c.b, {
        x: x + 0.35, y: gy + 1.32, w: cw - 0.7, h: 0.9,
        fontFace: FONT_BODY, fontSize: 10.5, color: C.zinc400, margin: 0,
      });
    });

    addFooter(s, "02 / 10");
  }

  {
    const s = pres.addSlide();
    paintBackground(s);
    addGlow(s, { x: -2, y: 3, w: 6, h: 6, transparency: 94 });
    addTopBar(s, "ROADMAP");

    s.addText("What you'll learn", {
      x: 0.5, y: 1.1, w: 9, h: 0.75,
      fontFace: FONT_TITLE, fontSize: 44, bold: true, color: C.text,
      charSpacing: -1.5, margin: 0,
    });
    s.addText("Short, focused videos. Watch the whole series or jump straight to what you need.", {
      x: 0.5, y: 1.95, w: 9, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, color: C.zinc400, margin: 0,
    });

    const items = [
      { n: "01", ic: Ic.zap,      t: "Getting Started",      len: "5 min" },
      { n: "02", ic: Ic.server,   t: "Dashboard Tour",       len: "2 min" },
      { n: "03", ic: Ic.play,     t: "Your First Deployment",len: "4 min" },
      { n: "04", ic: Ic.settings, t: "Managing Deployments", len: "3 min" },
      { n: "05", ic: Ic.box,      t: "Templates & Images",   len: "4 min" },
      { n: "5a", ic: Ic.package,  t: "Docker Hub Integration", len: "4 min" },
      { n: "06", ic: Ic.users,    t: "Users & Security",     len: "3 min" },
      { n: "07", ic: Ic.settings, t: "Settings & Data",      len: "2 min" },
      { n: "08", ic: Ic.shield,   t: "Production Deploy",    len: "3 min" },
      { n: "09", ic: Ic.db,       t: "Backup Policies",      len: "4 min" },
      { n: "10", ic: Ic.map,      t: "The Overview Map",     len: "3 min" },
      { n: "++", ic: Ic.layers,   t: "Tags, alerts & more",  len: "series" },
    ];

    const cols = 4, gap = 0.18;
    const colW = (10 - 0.5 * 2 - gap * (cols - 1)) / cols;
    const rowH = 0.58;
    const startY = 2.7;

    items.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = 0.5 + c * (colW + gap);
      const y = startY + r * (rowH + gap);
      addCard(s, { x, y, w: colW, h: rowH });
      s.addText(it.n, {
        x: x + 0.2, y, w: 0.5, h: rowH,
        fontFace: FONT_TITLE, fontSize: 11, bold: true, color: C.zinc500,
        valign: "middle", align: "left", margin: 0, charSpacing: 2,
      });
      s.addImage({ data: it.ic, x: x + 0.65, y: y + 0.17, w: 0.24, h: 0.24 });
      s.addText(it.t, {
        x: x + 0.98, y, w: colW - 1.55, h: rowH,
        fontFace: FONT_TITLE, fontSize: 11.5, bold: true, color: C.text,
        valign: "middle", margin: 0, charSpacing: -0.2,
      });
      s.addText(it.len, {
        x: x + colW - 0.75, y, w: 0.65, h: rowH,
        fontFace: FONT_BODY, fontSize: 8.5, color: C.zinc600,
        valign: "middle", align: "right", margin: 0, bold: true, charSpacing: 2,
      });
    });

    addFooter(s, "03 / 10");
  }

  function chapterSlide({ pageLabel, num, tag, title, subtitle, bullets, hint, iconData }) {
    const s = pres.addSlide();
    paintBackground(s);
    addGlow(s, { x: -2.5, y: -1.5, w: 6.5, h: 6.5, transparency: 94 });
    addGlow(s, { x: 6.5,  y: 3.5,  w: 5,   h: 5,   transparency: 95 });
    addTopBar(s, tag);

    s.addText(num, {
      x: 0.5, y: 1.15, w: 3.5, h: 2.2,
      fontFace: FONT_TITLE, fontSize: 180, bold: true, color: C.zinc800,
      charSpacing: -6, margin: 0, valign: "top",
    });

    s.addText(title, {
      x: 3.7, y: 1.3, w: 5.8, h: 0.9,
      fontFace: FONT_TITLE, fontSize: 40, bold: true, color: C.text,
      charSpacing: -1.5, margin: 0,
    });
    s.addText(subtitle, {
      x: 3.7, y: 2.2, w: 5.8, h: 0.55,
      fontFace: FONT_BODY, fontSize: 12.5, color: C.zinc400, margin: 0,
    });

    addCard(s, { x: 3.7, y: 2.9, w: 5.8, h: 2.3 });
    const items = bullets;
    const padY = 0.22;
    const rowH = (2.3 - padY * 2) / items.length;
    items.forEach((b, i) => {
      const y = 2.9 + padY + i * rowH;
      s.addImage({ data: Ic.chev, x: 3.9, y: y + (rowH - 0.18) / 2, w: 0.18, h: 0.18 });
      s.addText(b, {
        x: 4.18, y, w: 5.2, h: rowH,
        fontFace: FONT_BODY, fontSize: 12, color: C.zinc200,
        valign: "middle", margin: 0,
      });
    });

    addCard(s, { x: 0.5, y: 3.5, w: 3, h: 1.7 });
    s.addImage({ data: iconData, x: 0.5 + (3 - 0.9) / 2, y: 3.7, w: 0.9, h: 0.9 });
    s.addText(hint, {
      x: 0.7, y: 4.65, w: 2.6, h: 0.5,
      fontFace: FONT_BODY, fontSize: 9.5, color: C.zinc500,
      align: "center", italic: true, margin: 0,
    });

    addFooter(s, pageLabel);
  }

  chapterSlide({
    pageLabel: "04 / 10", num: "01", tag: "EPISODE 01",
    title: "Getting Started",
    subtitle: "From zero to a running Tainer instance in about five minutes.",
    iconData: Ic.zap,
    bullets: [
      "Create a Proxmox API token (user@realm!tokenname)",
      "Configure .env: PROXMOX_URL, token, default node & storage",
      "npm install → npm run build → npm run start",
      "First-run /setup screen creates your admin user",
      "Land on the dashboard, and you're live",
    ],
    hint: "Keep your Proxmox token secret. Rotate it yearly.",
  });

  chapterSlide({
    pageLabel: "05 / 10", num: "03", tag: "EPISODE 03",
    title: "Your First Deployment",
    subtitle: "Launch a container from the template catalog and open its console.",
    iconData: Ic.play,
    bullets: [
      "Browse /templates and pick one",
      "Fill in hostname, resources, storage, env vars",
      "Submit, then follow the task toast to 100%",
      "Start / stop / restart from the detail page",
      "Open the in-browser console",
    ],
    hint: "Task toasts poll the Proxmox UPID every few seconds.",
  });

  chapterSlide({
    pageLabel: "06 / 10", num: "5a", tag: "EPISODE 5A",
    title: "Docker Hub & Registries",
    subtitle: "Pull from Docker Hub, Gitea, custom OCI registries, or a local library.",
    iconData: Ic.package,
    bullets: [
      "Set DOCKER_HUB_USERNAME & _TOKEN for authenticated pulls",
      "Browse tags, platforms and sizes in /images",
      "Sync an image into a site & inspect its env-var cache",
      "Pull from Gitea or any custom OCI registry",
      "Offline mode: point DOCKER_LIBRARY_PATH at a Samba share",
    ],
    hint: "Env-var cache auto-populates launch forms.",
  });

  chapterSlide({
    pageLabel: "07 / 10", num: "09", tag: "EPISODE 09",
    title: "Backup Policies",
    subtitle: "Schedule snapshots, scope by tag, and restore with one click.",
    iconData: Ic.db,
    bullets: [
      "Scope: all deployments, or only tagged ones",
      "Mode: snapshot, suspend, or stop",
      "Compression: none / LZO / gzip / zstd",
      "Interval: 6h, 12h, 24h, 48h, or custom",
      "Per-deployment on-demand backup & restore",
    ],
    hint: "Retention is per-policy. Older backups prune automatically.",
  });

  chapterSlide({
    pageLabel: "08 / 10", num: "10", tag: "EPISODE 10",
    title: "The Overview Map",
    subtitle: "Your whole Proxmox estate on a single geographic canvas.",
    iconData: Ic.map,
    bullets: [
      "Add a site: URL, token, and map location pin",
      "Status dots: green online, amber degraded, red offline",
      "Mini-gauges for CPU, RAM, storage per site",
      "Search & filter sites from the sidebar",
      "Click a pin to drill into /sites/[siteSlug]",
    ],
    hint: "Ideal for multi-region or multi-DC setups.",
  });

  {
    const s = pres.addSlide();
    paintBackground(s);
    addGlow(s, { x: 6.5, y: -2, w: 6, h: 6, transparency: 94 });
    addTopBar(s, "PRODUCTION");

    s.addText("Every video, same rhythm.", {
      x: 0.5, y: 1.1, w: 9, h: 0.75,
      fontFace: FONT_TITLE, fontSize: 40, bold: true, color: C.text,
      charSpacing: -1.3, margin: 0,
    });
    s.addText("Short. Visual. Easy to skim. No filler.", {
      x: 0.5, y: 1.95, w: 9, h: 0.45,
      fontFace: FONT_BODY, fontSize: 13, color: C.zinc400, margin: 0,
    });

    const rows = [
      { ic: Ic.clock, k: "2-5 minutes",       v: "Each episode under 5 minutes. Viewers pick what they need." },
      { ic: Ic.zap,   k: "3-second intro",    v: "Logo + one-sentence summary. No long title cards." },
      { ic: Ic.term,  k: "Copy-paste ready",  v: "Every env var, CLI command, and API path is pinned on-screen." },
      { ic: Ic.arrow, k: "Clear next step",   v: "Outro always points at the next episode in the series." },
    ];

    const rowY0 = 2.7;
    const rowH  = 0.6;
    const gap   = 0.15;
    rows.forEach((r, i) => {
      const y = rowY0 + i * (rowH + gap);
      addCard(s, { x: 0.5, y, w: 9, h: rowH });
      s.addImage({ data: r.ic, x: 0.78, y: y + (rowH - 0.28) / 2, w: 0.28, h: 0.28 });
      s.addText(r.k, {
        x: 1.25, y, w: 2.2, h: rowH,
        fontFace: FONT_TITLE, fontSize: 13.5, bold: true, color: C.text,
        valign: "middle", charSpacing: -0.3, margin: 0,
      });
      s.addText(r.v, {
        x: 3.5, y, w: 5.8, h: rowH,
        fontFace: FONT_BODY, fontSize: 11.5, color: C.zinc400,
        valign: "middle", margin: 0,
      });
    });

    addFooter(s, "09 / 10");
  }

  {
    const s = pres.addSlide();
    paintBackground(s);
    addGlow(s, { x: -2.5, y: -1.5, w: 7, h: 7, transparency: 92 });
    addGlow(s, { x: 5.0,  y: 2.5,  w: 7, h: 7, transparency: 93 });

    addLogo(s, { x: 0.5, y: 0.5, w: 0.34 });
    addChip(s, 8.5, 0.56, 1.0, 0.26, "LET'S GO");

    s.addText("Ready when you are.", {
      x: 0.5, y: 1.95, w: 9, h: 1.1,
      fontFace: FONT_TITLE, fontSize: 72, bold: true, color: C.text,
      charSpacing: -2, margin: 0,
    });
    s.addText("Start with Episode 01, and we'll have you deploying in five.", {
      x: 0.5, y: 3.1, w: 9, h: 0.5,
      fontFace: FONT_BODY, fontSize: 14, color: C.zinc400, margin: 0,
    });

    const ctas = [
      { t: "Watch Episode 01",   s: "Install Tainer and run your first deployment.", ic: Ic.play },
      { t: "Read the roadmap",   s: "docs/video-series-plan.md has the full plan.",  ic: Ic.term },
    ];
    ctas.forEach((c, i) => {
      const x = 0.5 + i * 4.7;
      addCard(s, { x, y: 3.8, w: 4.3, h: 1.25 });
      s.addImage({ data: c.ic, x: x + 0.3, y: 4.05, w: 0.32, h: 0.32 });
      s.addText(c.t, {
        x: x + 0.8, y: 3.92, w: 3.2, h: 0.36,
        fontFace: FONT_TITLE, fontSize: 14, bold: true, color: C.text,
        charSpacing: -0.3, margin: 0,
      });
      s.addText(c.s, {
        x: x + 0.8, y: 4.28, w: 3.2, h: 0.7,
        fontFace: FONT_BODY, fontSize: 10.5, color: C.zinc400, margin: 0,
      });
      s.addImage({ data: Ic.arrow, x: x + 3.88, y: 4.1, w: 0.22, h: 0.22 });
    });

    addFooter(s, "10 / 10");
  }

  const out = path.resolve(__dirname, "tainer-tutorial-series.pptx");
  await pres.writeFile({ fileName: out });
  console.log("Wrote " + out);
}

build().catch((e) => { console.error(e); process.exit(1); });
