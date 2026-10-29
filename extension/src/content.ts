import { domAdapter, selectedTitle } from "./dom-adapter";
import { inspectPage } from "./inspect";
import { overlay } from "./overlay";
import { runSession, summarize } from "./runner";
import { mergeSelectors, type SelectorConfig } from "./selectors";
import type { RunReport, SessionExport } from "./types";

declare global {
  interface Window {
    __psaPrepLoaded?: boolean;
  }
}

type Msg =
  | { type: "inspect" }
  | { type: "run"; session: SessionExport; mode: "simulation" | "real"; startAt: number; selectors: Partial<SelectorConfig> | null };

if (!window.__psaPrepLoaded) {
  window.__psaPrepLoaded = true;
  let running = false;

  chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    if (msg.type === "inspect") {
      const data = inspectPage();
      overlay.show(`<div>Inspection terminée : ${data.fields.length} champs, ${data.buttons.length} boutons. Le rapport est dans le popup (lecture seule, rien n'a été touché).</div>`);
      sendResponse({ ok: true, data });
      return;
    }
    if (msg.type === "run") {
      if (running) return sendResponse({ ok: false, error: "Un remplissage est déjà en cours" });
      running = true;
      const cfg = mergeSelectors(msg.selectors);
      overlay.stopRequested = false;
      overlay.getSelectedTitle = () => selectedTitle(cfg);
      runSession(msg.session, domAdapter, cfg, msg.mode, {
        shouldStop: () => overlay.stopRequested,
        onConfirmed: async (item, title) => {
          await chrome.runtime.sendMessage({ type: "api", path: "/api/ext/confirm", method: "POST", body: { itemId: item.itemId, title } });
        },
      })
        .then((report: RunReport) => chrome.storage.local.set({ lastReport: report, lastSummary: summarize(report) }))
        .catch((e) => overlay.show(`<div style="color:#f07b72">${String(e instanceof Error ? e.message : e).replace(/[&<>]/g, "")}</div>`))
        .finally(() => (running = false));
      sendResponse({ ok: true });
    }
  });
}
