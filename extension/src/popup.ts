import type { SessionExport } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const msg = (text: string, error = false) => {
  $("msg").textContent = text;
  $("msg").className = error ? "err" : "muted";
};

async function api<T>(path: string): Promise<T> {
  const r = (await chrome.runtime.sendMessage({ type: "api", path })) as { ok: boolean; data?: T; error?: string };
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www|app)\.psacard\.com\//.test(tab.url ?? "")) throw new Error("Ouvre d'abord le PSA Online Submission Center (psacard.com), connecté, dans l'onglet actif.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  return tab.id;
}

async function init() {
  const store = (await chrome.storage.local.get(["serverUrl", "selectors", "lastSummary", "lastInspect"])) as {
    serverUrl?: string;
    selectors?: string;
    lastSummary?: string;
    lastInspect?: unknown;
  };
  $<HTMLInputElement>("serverUrl").value = store.serverUrl ?? "";
  $<HTMLTextAreaElement>("selectors").value = store.selectors ?? "";
  if (store.lastSummary) $("report").textContent = store.lastSummary;
  if (store.lastInspect) $("inspectOut").textContent = JSON.stringify(store.lastInspect, null, 1).slice(0, 4000);
  try {
    const sessions = await api<{ id: string; name: string; items: number; green: number; orange: number; red: number }[]>("/api/ext/sessions");
    $<HTMLSelectElement>("session").replaceChildren(
      ...sessions.map((s) => new Option(`${s.name} — ${s.items} cartes (${s.green}/${s.orange}/${s.red})`, s.id)),
    );
    if (!sessions.length) msg("Aucune session dans l'application locale.");
  } catch (e) {
    msg(e instanceof Error ? e.message : String(e), true);
  }
}

$("save").onclick = async () => {
  const raw = $<HTMLTextAreaElement>("selectors").value.trim();
  if (raw) {
    try {
      JSON.parse(raw);
    } catch {
      return msg("Surcharge des sélecteurs : JSON invalide", true);
    }
  }
  await chrome.storage.local.set({ serverUrl: $<HTMLInputElement>("serverUrl").value.trim() || "http://localhost:3000", selectors: raw });
  msg("Réglages enregistrés");
  void init();
};

$("inspect").onclick = async () => {
  try {
    const tabId = await activeTab();
    const r = (await chrome.tabs.sendMessage(tabId, { type: "inspect" })) as { data: unknown };
    await chrome.storage.local.set({ lastInspect: r.data });
    $("inspectOut").textContent = JSON.stringify(r.data, null, 1).slice(0, 4000);
    msg("Inspection faite (lecture seule). Copie le rapport pour ajuster selectors.ts.");
  } catch (e) {
    msg(e instanceof Error ? e.message : String(e), true);
  }
};

$("copyInspect").onclick = async () => {
  const { lastInspect } = await chrome.storage.local.get("lastInspect");
  await navigator.clipboard.writeText(JSON.stringify(lastInspect ?? {}, null, 2));
  msg("Rapport d'inspection copié");
};

$("run").onclick = async () => {
  try {
    const id = $<HTMLSelectElement>("session").value;
    if (!id) throw new Error("Choisis une session");
    const mode = $<HTMLSelectElement>("mode").value as "simulation" | "real";
    if (mode === "real" && !confirm("Remplissage réel : l'extension va saisir les items un par un. Elle ne validera ni ne paiera rien. Continuer ?")) return;
    const session = await api<SessionExport>(`/api/ext/sessions/${id}`);
    const { selectors } = (await chrome.storage.local.get("selectors")) as { selectors?: string };
    const tabId = await activeTab();
    await chrome.tabs.sendMessage(tabId, {
      type: "run",
      session,
      mode,
      startAt: Number($<HTMLInputElement>("startAt").value) || 1,
      selectors: selectors ? JSON.parse(selectors) : null,
    });
    msg("Lancé : suis l'avancement dans le panneau en bas à droite de la page PSA.");
  } catch (e) {
    msg(e instanceof Error ? e.message : String(e), true);
  }
};

void init();
