// Job Board: loads data/jobs.csv and renders a filterable table and map.
// See README.md for the expected CSV columns.

const CSV_PATH = "data/jobs.csv";
const MAP_CENTER = [44.476, -73.2126]; // Burlington City Hall

// Fit score colors: single-hue ordinal ramp, kept in sync with --fit-* in style.css.
const FIT_COLORS = { 1: "#86b6ef", 2: "#5598e7", 3: "#2a78d6", 4: "#1c5cab", 5: "#104281" };
const FIT_LABELS = { 1: "Poor", 2: "Weak", 3: "Moderate", 4: "Strong", 5: "Excellent" };

// "My list": the stages a saved job moves through, in order.
const STAGES = ["Interested", "Applied", "Interviewing", "Offer", "Not pursuing"];
const TRACKER_KEY = "jobTracker";
const MAX_SORT_LEVELS = 3;
const DEFAULT_SORT = [{ key: "fit", dir: -1 }];

const state = {
  rows: [],
  search: "",
  openOnly: false,
  minFit: 0,
  connector: "",
  orgType: "",
  employment: "",
  workMode: "",
  maxMiles: null,
  minPay: null,
  tags: new Set(),
  myList: "",           // "" = any, "*" = any saved job, or a stage name
  // Most recently clicked column first; later entries break ties. dir: 1 = ascending, -1 = descending
  sort: structuredClone(DEFAULT_SORT),
  expanded: new Set(),  // ids of rows with details open
};

// ---------- CSV ----------

// RFC 4180-style parser: handles quoted fields, escaped quotes, and newlines inside quotes.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  text = text.replace(/^﻿/, ""); // strip BOM (Excel exports)

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  return rows.filter(r => r.some(v => v.trim() !== ""));
}

function toObjects(table) {
  const [header, ...body] = table;
  const columns = header.map(h => h.trim());
  return body.map(r =>
    Object.fromEntries(columns.map((col, i) => [col, (r[i] ?? "").trim()]))
  );
}

// ---------- My list (saved in this browser) ----------

// { [job id]: { stage, notes, updated } }. Keyed by id, so it survives updates to jobs.csv.
let tracker = loadTracker();

function loadTracker() {
  try { return JSON.parse(localStorage.getItem(TRACKER_KEY)) || {}; }
  catch { return {}; }
}

function saveTracker() {
  try { localStorage.setItem(TRACKER_KEY, JSON.stringify(tracker)); }
  catch (err) { alert(`Could not save your list: ${err.message}`); }
}

function updateTracker(id, changes) {
  const entry = { ...tracker[id], ...changes, updated: new Date().toISOString().slice(0, 10) };
  if (!entry.stage && !entry.notes) delete tracker[id];
  else tracker[id] = entry;
  saveTracker();
}

const stageOf = r => tracker[r.id]?.stage || "";

function exportTracker() {
  const blob = new Blob([JSON.stringify(tracker, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `my-job-list-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importTracker(file) {
  try {
    const data = JSON.parse(await file.text());
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("not a saved list");
    Object.assign(tracker, data);
    saveTracker();
    render();
  } catch (err) {
    alert(`Could not import ${file.name}: ${err.message}`);
  }
}

// ---------- Normalization ----------

const num = v => (v === "" || v == null || isNaN(+v) ? null : +v);

// The CSV's free-text fields are grouped into a few categories for the dropdowns.
function workModeCategory(s) {
  if (/hybrid/i.test(s)) return "Hybrid";
  if (/remote|home-based/i.test(s)) return "Remote / home-based";
  if (/unconfirmed/i.test(s)) return "Unconfirmed";
  return "On-site";
}

function employmentCategory(s) {
  if (/unconfirmed/i.test(s)) return "Unconfirmed";
  if (/temporary/i.test(s)) return "Temporary";
  if (/contract/i.test(s)) return "Contract";
  if (/part-time|per diem|per-semester/i.test(s)) return "Part-time / per diem";
  if (/full-time/i.test(s)) return "Full-time";
  return "Other";
}

function connectorCategory(s) {
  const word = (s.match(/^\w+/) || ["Unknown"])[0];
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function normalize(r) {
  return {
    ...r,
    fit: num(r.fit_score),
    open: /^yes/i.test(r.is_open),
    lat: num(r.latitude),
    lng: num(r.longitude),
    miles: num(r.miles_from_burlington_city_hall),
    hourlyMin: num(r.est_hourly_min),
    hourlyMax: num(r.est_hourly_max),
    annualMin: num(r.est_annual_min),
    annualMax: num(r.est_annual_max),
    deadlineDate: parseISODate(r.deadline),
    tagList: r.tags.split(";").map(t => t.trim()).filter(Boolean),
    workModeCat: workModeCategory(r.work_mode),
    employmentCat: employmentCategory(r.employment_type),
    connectorCat: connectorCategory(r.connector_compatible),
    approximate: /^approximate/i.test(r.geocode_method),
    addressUnverified: !/^yes/i.test(r.address_verified),
    searchText: [r.title, r.organization, r.description, r.requirements, r.tags,
      r.fit_rationale, r.city, r.notes].join(" ").toLowerCase(),
  };
}

// ---------- Formatting ----------

const money = n => "$" + Math.round(n).toLocaleString("en-US");
const hourly = n => "$" + (Number.isInteger(n) ? n : n.toFixed(2));

function range(min, max, fmt) {
  if (min == null && max == null) return "";
  if (max == null) return `${fmt(min)}+`;
  if (min == null || min === max) return fmt(max);
  return `${fmt(min)} – ${fmt(max)}`;
}

// The pay in the other unit, so hourly and salaried roles can be compared at a glance.
function payEquivalent(r) {
  if (r.pay_unit === "year") return range(r.hourlyMin, r.hourlyMax, hourly) && `≈ ${range(r.hourlyMin, r.hourlyMax, hourly)}/hr`;
  if (r.pay_unit === "hour") return range(r.annualMin, r.annualMax, money) && `≈ ${range(r.annualMin, r.annualMax, money)}/yr`;
  return "";
}

function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function safeUrl(url) {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

// Small DOM helper: el("a", { href: "#", className: "x" }, "text", childNode)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === "" || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

// ---------- Filtering & sorting ----------

const COLUMNS = [
  { key: "mine", label: "My list", value: r => (stageOf(r) ? STAGES.indexOf(stageOf(r)) : null) },
  { key: "fit", label: "Fit", value: r => r.fit, defaultDir: -1 },
  { key: "title", label: "Role", value: r => r.title },
  { key: "employment", label: "Type", value: r => r.employment_type },
  { key: "mode", label: "Work mode", value: r => r.workModeCat },
  { key: "pay", label: "Pay", value: r => r.hourlyMin ?? r.hourlyMax, defaultDir: -1 },
  { key: "deadline", label: "Deadline", value: r => r.deadline || null },
  { key: "status", label: "Status", value: r => (r.open ? 0 : 1) },
  { key: "miles", label: "Miles", value: r => r.miles, className: "num" },
];

function matches(r) {
  if (state.myList) {
    const stage = stageOf(r);
    if (!stage || (state.myList !== "*" && stage !== state.myList)) return false;
  }
  if (state.openOnly && !r.open) return false;
  if (state.minFit && (r.fit ?? 0) < state.minFit) return false;
  if (state.connector && r.connectorCat !== state.connector) return false;
  if (state.orgType && r.org_type !== state.orgType) return false;
  if (state.employment && r.employmentCat !== state.employment) return false;
  if (state.workMode && r.workModeCat !== state.workMode) return false;
  if (state.maxMiles != null && (r.miles == null || r.miles > state.maxMiles)) return false;
  if (state.minPay != null) {
    const top = r.hourlyMax ?? r.hourlyMin;
    if (top != null && top < state.minPay) return false; // unposted pay stays visible
  }
  for (const t of state.tags) if (!r.tagList.includes(t)) return false;
  if (state.search && !r.searchText.includes(state.search)) return false;
  return true;
}

// Blank values always sort last, whichever direction is chosen.
function compare(a, b, dir) {
  const aBlank = a == null || a === "";
  const bBlank = b == null || b === "";
  if (aBlank || bBlank) return aBlank - bBlank;
  const cmp = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  return cmp * dir;
}

function visibleRows() {
  const levels = state.sort.map(s => ({ ...s, col: COLUMNS.find(c => c.key === s.key) }));
  return state.rows
    .filter(matches)
    .sort((a, b) =>
      levels.reduce((cmp, { col, dir }) => cmp || compare(col.value(a), col.value(b), dir), 0) ||
      compare(Number(b.open), Number(a.open), 1) ||
      compare(a.deadline || null, b.deadline || null, 1) ||
      compare(a.id, b.id, 1));
}

// ---------- Table ----------

function renderHeader() {
  const tr = el("tr");
  for (const col of COLUMNS) {
    const rank = state.sort.findIndex(s => s.key === col.key);
    const dir = rank >= 0 ? (state.sort[rank].dir === 1 ? "ascending" : "descending") : null;
    const btn = el("button", { type: "button" }, col.label,
      rank > 0 && el("span", { className: "sort-rank", title: `Tie-breaker #${rank}` }, rank + 1));
    // Clicking a new column makes it the main sort and keeps the previous sorts as tie-breakers.
    btn.addEventListener("click", () => {
      if (rank === 0) state.sort[0].dir *= -1;
      else {
        const prev = rank > 0 ? state.sort.splice(rank, 1)[0] : null;
        state.sort.unshift({ key: col.key, dir: prev?.dir ?? col.defaultDir ?? 1 });
        state.sort.length = Math.min(state.sort.length, MAX_SORT_LEVELS);
      }
      render();
    });
    tr.append(el("th", {
      scope: "col",
      className: col.className,
      "data-sort": dir,
      "aria-sort": rank === 0 ? dir : "none",
    }, btn));
  }
  document.querySelector("#jobs thead").replaceChildren(tr);
}

function locationWarning(r) {
  const notes = [];
  if (r.approximate) notes.push("Map location is approximate");
  if (r.addressUnverified) notes.push(`Address: ${r.address_verified}`);
  return notes.join(". ");
}

function deadlineCell(r) {
  if (!r.deadlineDate) return el("td", { className: "nowrap" }, el("span", { className: "sub" }, "None listed"));
  const days = daysUntil(r.deadlineDate);
  const cls = days < 0 ? "past" : days <= 7 ? "soon" : "";
  const rel = days < 0 ? `${-days}d ago` : days === 0 ? "today" : `in ${days}d`;
  return el("td", { className: "nowrap" },
    el("span", { className: `deadline ${cls}` }, formatDate(r.deadlineDate)),
    el("span", { className: "sub" }, rel));
}

function jobRow(r) {
  const expanded = state.expanded.has(r.id);
  const warning = locationWarning(r);
  const toggle = el("button", {
    type: "button",
    className: "role-title",
    "aria-expanded": String(expanded),
    "aria-controls": `detail-${r.id}`,
  }, r.title, warning && el("span", { className: "warn-icon", title: warning, "aria-label": warning }, " ⚠"));

  const stage = el("select", { className: `stage-select${stageOf(r) ? " saved" : ""}`, "aria-label": `My list status for ${r.title}` },
    new Option("☆ Save", ""), ...STAGES.map(s => new Option(s, s)));
  stage.value = stageOf(r);
  stage.addEventListener("change", () => { updateTracker(r.id, { stage: stage.value }); render(); });

  const tr = el("tr", { className: `job${r.open ? "" : " closed"}`, id: `job-${r.id}` },
    el("td", {}, stage),
    el("td", {}, el("span", { className: `fit fit-${r.fit}`, title: r.fit_label }, r.fit ?? "–")),
    el("td", {},
      toggle,
      el("div", { className: "org" }, r.organization)),
    el("td", {}, r.employment_type),
    el("td", {}, r.work_mode),
    el("td", {}, r.pay_display, el("span", { className: "sub" }, payEquivalent(r))),
    deadlineCell(r),
    el("td", {},
      el("span", { className: `pill ${r.open ? "open" : "not-open"}` }, r.open ? "Open" : "Not open"),
      r.status.toLowerCase() !== "open" && el("span", { className: "sub" }, r.status)),
    el("td", { className: "num" }, r.miles != null ? r.miles.toFixed(1) : ""),
  );

  tr.addEventListener("click", e => {
    if (e.target.closest("a, select")) return;
    if (expanded) state.expanded.delete(r.id); else state.expanded.add(r.id);
    render();
    document.querySelector(`#job-${CSS.escape(r.id)} .role-title`)?.focus();
  });
  return tr;
}

function field(label, value) {
  return value ? [el("dt", {}, label), el("dd", {}, value)] : [];
}

function detailRow(r) {
  const apply = safeUrl(r.apply_url);
  const source = safeUrl(r.source_url);
  const callouts = [];
  if (r.approximate) callouts.push(el("div", { className: "callout" },
    el("strong", {}, "Approximate map location. "), r.geocode_method));
  if (r.addressUnverified) callouts.push(el("div", { className: "callout" },
    el("strong", {}, "Address not fully verified. "), r.address_verified));

  const left = el("div", {},
    el("h3", {}, `Fit: ${r.fit_label} (${r.fit}/5)`),
    el("p", {}, r.fit_rationale),
    el("h3", {}, "Description"),
    el("p", {}, r.description),
    el("h3", {}, "Requirements"),
    el("p", {}, r.requirements),
    el("h3", {}, "How to apply"),
    el("p", {}, r.how_to_apply),
    el("div", { className: "actions" },
      apply && el("a", { href: apply, target: "_blank", rel: "noopener" }, apply.startsWith("mailto:") ? "Email application" : "Apply / job page"),
      source && source !== apply && el("a", { href: source, target: "_blank", rel: "noopener" }, "Source posting")),
  );

  const notes = el("textarea", { className: "notes", rows: 3, placeholder: "Contacts, dates, follow-ups…", "aria-label": `My notes for ${r.title}` });
  notes.value = tracker[r.id]?.notes || "";
  notes.addEventListener("input", () => updateTracker(r.id, { notes: notes.value }));
  const updated = tracker[r.id]?.updated;

  const right = el("div", {},
    el("h3", {}, "My notes"),
    notes,
    updated && el("span", { className: "sub" }, `Last updated ${formatDate(parseISODate(updated))}`),
    el("h3", {}, "Details"),
    el("dl", {},
      field("Org type", r.org_type),
      field("Hours/week", r.hours_per_week),
      field("Connector compatible", r.connector_compatible),
      field("Pay", r.pay_display),
      field("Pay source", r.pay_source),
      field("Est. hourly", range(r.hourlyMin, r.hourlyMax, hourly)),
      field("Est. annual", range(r.annualMin, r.annualMax, money)),
      field("Posted", r.posted_date),
      field("Deadline", r.deadline),
      field("Status", r.status),
      field("Tags", r.tagList.join(", ")),
      field("Address", r.full_address),
      field("County", r.county),
      field("Distance", r.miles != null ? `${r.miles} mi (straight line from Burlington City Hall)` : ""),
      field("Notes", r.notes),
      field("Last checked", r.last_checked),
    ),
    callouts,
  );

  return el("tr", { className: "detail", id: `detail-${r.id}` },
    el("td", { colSpan: COLUMNS.length }, el("div", { className: "detail detail-grid" }, left, right)));
}

function renderBody(rows) {
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    frag.append(jobRow(r));
    if (state.expanded.has(r.id)) frag.append(detailRow(r));
  }
  if (!rows.length) {
    frag.append(el("tr", {}, el("td", { colSpan: COLUMNS.length }, "No roles match these filters.")));
  }
  document.querySelector("#jobs tbody").replaceChildren(frag);
}

// ---------- Map ----------

let map = null;
let markerLayer = null;

function initMap() {
  if (typeof L === "undefined") {
    document.getElementById("map").replaceChildren(
      el("p", { className: "status" }, "Map unavailable (Leaflet failed to load)."));
    return;
  }
  map = L.map("map", { scrollWheelZoom: false }).setView(MAP_CENTER, 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  const points = state.rows.filter(r => r.lat != null && r.lng != null).map(r => [r.lat, r.lng]);
  if (points.length) map.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
}

function focusJob(id) {
  state.expanded.add(id);
  history.replaceState(null, "", `#${id}`);
  render();
  const row = document.getElementById(`job-${id}`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("highlight");
  setTimeout(() => row.classList.remove("highlight"), 2000);
}

function popupContent(group) {
  const list = el("ul", {}, group.map(r => {
    const btn = el("button", { type: "button", className: "linklike" }, r.title);
    btn.addEventListener("click", () => { map.closePopup(); focusJob(r.id); });
    return el("li", {}, btn, ` (fit ${r.fit}${r.open ? "" : ", not open"})`, el("br"), r.organization);
  }));
  const first = group[0];
  return el("div", {},
    el("strong", {}, first.full_address),
    list,
    group.some(r => r.approximate) && el("p", { className: "popup-warn" }, `⚠ Approximate: ${first.geocode_method}`),
    group.some(r => r.addressUnverified) && el("p", { className: "popup-warn" }, "⚠ Address not fully verified"));
}

// One marker per location; several roles can share an office.
function renderMap(rows) {
  if (!markerLayer) return;
  markerLayer.clearLayers();

  const groups = new Map();
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const key = `${r.lat},${r.lng}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  for (const group of groups.values()) {
    const best = Math.max(...group.map(r => r.fit ?? 1));
    const approximate = group.some(r => r.approximate);
    const marker = L.circleMarker([group[0].lat, group[0].lng], {
      radius: group.length > 1 ? 11 : 8,
      fillColor: FIT_COLORS[best] ?? FIT_COLORS[1],
      fillOpacity: 0.95,
      color: approximate ? "#1f2328" : "#ffffff",
      weight: 2,
      dashArray: approximate ? "4 3" : null,
    });
    const label = group.length > 1
      ? `${group.length} roles · best fit ${best}`
      : `${group[0].title} · fit ${best}`;
    marker.bindTooltip(label + (approximate ? " · approximate location" : ""));
    marker.bindPopup(() => popupContent(group));
    markerLayer.addLayer(marker);
  }
}

function renderLegend() {
  const items = [5, 4, 3, 2, 1].map(f =>
    el("span", {}, el("span", { className: "swatch", style: `background:${FIT_COLORS[f]}` }), `${f} ${FIT_LABELS[f]}`));
  document.getElementById("legend").replaceChildren(
    el("span", {}, "Fit:"),
    ...items,
    el("span", {}, el("span", { className: "swatch approx" }), "Approximate location"),
    el("span", {}, "Remote and home-based roles are mapped to the employer's office. Larger dots mean several roles share a location."));
}

// ---------- Controls ----------

function fillSelect(id, values) {
  const select = document.getElementById(id);
  select.replaceChildren(new Option("Any", ""), ...values.map(v => new Option(v, v)));
  return select;
}

function distinct(fn) {
  return [...new Set(state.rows.map(fn).filter(Boolean))].sort();
}

function buildControls() {
  const bindSelect = (id, key, values, parse = v => v) => {
    const select = values ? fillSelect(id, values) : document.getElementById(id);
    select.addEventListener("change", () => { state[key] = parse(select.value); render(); });
  };

  bindSelect("connector", "connector", ["Yes", "Maybe", "Unlikely", "No"]
    .filter(v => state.rows.some(r => r.connectorCat === v))
    .concat(distinct(r => r.connectorCat).filter(v => !["Yes", "Maybe", "Unlikely", "No"].includes(v))));
  bindSelect("org-type", "orgType", distinct(r => r.org_type));
  bindSelect("employment", "employment", distinct(r => r.employmentCat));
  bindSelect("work-mode", "workMode", distinct(r => r.workModeCat));
  bindSelect("min-fit", "minFit", null, Number);
  bindSelect("max-miles", "maxMiles", null, v => (v === "" ? null : Number(v)));

  document.getElementById("my-list").replaceChildren(
    new Option("Any", ""), new Option("All saved", "*"), ...STAGES.map(s => new Option(s, s)));
  bindSelect("my-list", "myList");

  document.getElementById("export").addEventListener("click", exportTracker);
  const importFile = document.getElementById("import-file");
  document.getElementById("import").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    if (importFile.files[0]) importTracker(importFile.files[0]);
    importFile.value = "";
  });

  const minPay = document.getElementById("min-pay");
  minPay.addEventListener("input", () => {
    state.minPay = minPay.value === "" ? null : Number(minPay.value);
    render();
  });

  const search = document.getElementById("search");
  search.addEventListener("input", () => {
    state.search = search.value.trim().toLowerCase();
    render();
  });

  const openOnly = document.getElementById("open-only");
  openOnly.addEventListener("change", () => { state.openOnly = openOnly.checked; render(); });

  const tagBox = document.getElementById("tags");
  const counts = new Map();
  for (const r of state.rows) for (const t of r.tagList) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  tagBox.replaceChildren(el("span", { className: "status" }, "Tags:"), ...tags.map(t => {
    const btn = el("button", { type: "button", className: "tag", "aria-pressed": "false" }, `${t} (${counts.get(t)})`);
    btn.addEventListener("click", () => {
      if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
      btn.setAttribute("aria-pressed", String(state.tags.has(t)));
      render();
    });
    return btn;
  }));

  document.getElementById("reset").addEventListener("click", () => {
    Object.assign(state, {
      search: "", openOnly: false, minFit: 0, connector: "", orgType: "", employment: "",
      workMode: "", maxMiles: null, minPay: null, tags: new Set(), myList: "",
      sort: structuredClone(DEFAULT_SORT),
    });
    state.expanded.clear();
    document.querySelectorAll(".controls select").forEach(s => (s.selectedIndex = 0));
    search.value = "";
    minPay.value = "";
    openOnly.checked = false;
    tagBox.querySelectorAll(".tag").forEach(b => b.setAttribute("aria-pressed", "false"));
    render();
  });
}

// ---------- Main ----------

function render() {
  const rows = visibleRows();
  renderHeader();
  renderBody(rows);
  renderMap(rows);

  const checked = state.rows.map(r => r.last_checked).filter(Boolean).sort().pop();
  const snapshot = checked ? ` · Status as of ${formatDate(parseISODate(checked) ?? new Date(checked))}. Postings close fast, so confirm before applying.` : "";
  const label = key => COLUMNS.find(c => c.key === key).label;
  const sortedBy = state.sort.map(s => label(s.key)).join(", then ");
  const saved = state.rows.filter(stageOf).length;
  document.getElementById("status").textContent =
    `Showing ${rows.length} of ${state.rows.length} roles · ${saved} on your list · Sorted by ${sortedBy}${snapshot}`;
}

async function init() {
  const status = document.getElementById("status");
  try {
    const res = await fetch(CSV_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = parseCSV(await res.text());
    if (table.length < 2) throw new Error("CSV has no rows");

    state.rows = toObjects(table).map(normalize);
    buildControls();
    renderLegend();
    initMap();
    render();

    // A link like index.html#J002 opens that role.
    const id = decodeURIComponent(location.hash.slice(1));
    if (state.rows.some(r => r.id === id)) focusJob(id);
  } catch (err) {
    status.textContent = `Could not load ${CSV_PATH}: ${err.message}`;
    console.error(err);
  }
}

init();
