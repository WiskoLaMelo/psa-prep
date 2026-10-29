import { assertClickable, assertFillable } from "./guard";
import type { PageAdapter } from "./runner";
import type { SelectorConfig } from "./selectors";
import type { RunReport, SessionExportItem } from "./types";
import { overlay } from "./overlay";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !!r && r.width > 0 && r.height > 0;
}

function first(selector: string): HTMLElement | null {
  if (!selector) return null;
  try {
    return ([...document.querySelectorAll<HTMLElement>(selector)].find(visible) ?? null) as HTMLElement | null;
  } catch {
    return null;
  }
}

/** Saisie compatible avec les champs contrôlés (React…) : setter natif + événements input/change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const highlighted: HTMLElement[] = [];

export const domAdapter: PageAdapter = {
  highlight(selector, label) {
    let els: HTMLElement[] = [];
    try {
      els = selector ? [...document.querySelectorAll<HTMLElement>(selector)].filter(visible).slice(0, 8) : [];
    } catch {
      els = [];
    }
    for (const el of els) {
      el.dataset.psaPrepOutline = el.style.outline;
      el.style.outline = "3px solid #f0a64d";
      el.style.outlineOffset = "2px";
      highlighted.push(el);
    }
    if (els[0]) overlay.tag(els[0], label);
    return els.length > 0;
  },
  clearHighlights() {
    for (const el of highlighted.splice(0)) el.style.outline = el.dataset.psaPrepOutline ?? "";
    overlay.clearTags();
  },
  async fill(selector, value, keystrokeMs) {
    const el = first(selector) as HTMLInputElement | null;
    if (!el) return false;
    assertFillable(el);
    el.focus();
    setNativeValue(el, "");
    // Rythme humain : caractère par caractère.
    for (let i = 1; i <= value.length; i++) {
      setNativeValue(el, value.slice(0, i));
      await sleep(keystrokeMs);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  },
  async click(selector) {
    const el = first(selector);
    if (!el) return false;
    assertClickable(el);
    el.click();
    return true;
  },
  readResults(cfg) {
    return rows(cfg).map((row) => titleOf(row, cfg));
  },
  async chooseResult(cfg, index) {
    const row = rows(cfg)[index];
    if (!row) throw new Error("Résultat disparu de la page");
    const target = (cfg.resultChoose ? row.querySelector<HTMLElement>(cfg.resultChoose) : null) ?? row;
    assertClickable(target);
    target.scrollIntoView({ block: "center" });
    target.click();
    await sleep(400);
  },
  async waitFor(selector, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (first(selector)) return true;
      await sleep(150);
    }
    return false;
  },
  askUser(message: string, item: SessionExportItem) {
    return overlay.ask(message, item);
  },
  sleep,
  progress(report: RunReport, current: SessionExportItem | null) {
    overlay.progress(report, current);
  },
};

function rows(cfg: SelectorConfig): HTMLElement[] {
  try {
    return [...document.querySelectorAll<HTMLElement>(cfg.resultRow)].filter(visible);
  } catch {
    return [];
  }
}

function titleOf(row: HTMLElement, cfg: SelectorConfig): string {
  const el = (cfg.resultTitle ? row.querySelector<HTMLElement>(cfg.resultTitle) : null) ?? row;
  return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
}

/** Titre du résultat actuellement sélectionné par l'utilisateur, s'il est repérable. */
export function selectedTitle(cfg: SelectorConfig): string | null {
  const sel = rows(cfg).find((r) => r.getAttribute("aria-selected") === "true" || r.matches(".selected, [class*='selected' i], [class*='active' i]"));
  return sel ? titleOf(sel, cfg) : null;
}
