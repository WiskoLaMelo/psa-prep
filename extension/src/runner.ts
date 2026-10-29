import type { SelectorConfig } from "./selectors";
import { pickResult } from "./match";
import type { ItemReport, RunReport, SessionExport, SessionExportItem } from "./types";

/**
 * Accès à la page, isolé pour que le déroulé soit testable sans navigateur.
 * L'implémentation réelle (dom-adapter.ts) passe chaque clic et saisie par le garde-fou.
 */
export interface PageAdapter {
  highlight(selector: string, label: string): boolean;
  clearHighlights(): void;
  fill(selector: string, value: string, keystrokeMs: number): Promise<boolean>;
  click(selector: string): Promise<boolean>;
  readResults(cfg: SelectorConfig): string[];
  chooseResult(cfg: SelectorConfig, index: number): Promise<void>;
  waitFor(selector: string, timeoutMs: number): Promise<boolean>;
  /** Demande à l'utilisateur d'agir à la main ; renvoie le titre choisi s'il est lisible, ou null s'il passe l'item. */
  askUser(message: string, item: SessionExportItem): Promise<{ action: "continue" | "skip"; chosenTitle: string | null }>;
  sleep(ms: number): Promise<void>;
  progress(report: RunReport, current: SessionExportItem | null): void;
}

export interface RunnerHooks {
  /** Chaque titre PSA sélectionné est renvoyé à l'API locale (correspondance confirmée). */
  onConfirmed(item: SessionExportItem, title: string): Promise<void>;
  shouldStop(): boolean;
}

/**
 * Rejoue une session : pour chaque item dans l'ordre, recherche, choix du résultat exact, valeur déclarée.
 * S'arrête toujours avant toute validation : la relecture, la validation et le paiement restent à l'utilisateur.
 */
export async function runSession(
  session: SessionExport,
  page: PageAdapter,
  cfg: SelectorConfig,
  mode: "simulation" | "real",
  hooks: RunnerHooks,
  startAt = 1,
): Promise<RunReport> {
  const report: RunReport = { sessionName: session.session.name, mode, startedAt: new Date().toISOString(), items: [] };
  const items = session.items.filter((i) => i.position >= startAt).sort((a, b) => a.position - b.position);

  for (const item of items) {
    if (hooks.shouldStop()) break;
    page.progress(report, item);
    let r: ItemReport;
    try {
      r = mode === "simulation" ? simulate(item, page, cfg) : await fillItem(item, page, cfg, hooks);
    } catch (e) {
      r = { position: item.position, label: item.label, outcome: "error", message: e instanceof Error ? e.message : String(e) };
      // Garde-fou déclenché : on arrête tout plutôt que de continuer à l'aveugle.
      if (e instanceof Error && e.name === "GuardError") {
        report.items.push(r);
        break;
      }
    }
    report.items.push(r);
    page.progress(report, null);
    await page.sleep(cfg.timing.betweenItems);
  }
  page.clearHighlights();
  report.finishedAt = new Date().toISOString();
  page.progress(report, null);
  return report;
}

function simulate(item: SessionExportItem, page: PageAdapter, cfg: SelectorConfig): ItemReport {
  page.clearHighlights();
  const found = [
    page.highlight(cfg.searchInput, `Recherche : ${item.searchStrings[0] ?? "—"}`),
    page.highlight(cfg.resultRow, "Résultats"),
    page.highlight(cfg.declaredValueInput, `Valeur : ${item.declaredValue ?? "—"}`),
    page.highlight(cfg.addItemButton, "Ajouter l'item"),
  ];
  const missing = ["recherche", "résultats", "valeur déclarée", "ajout"].filter((_, i) => !found[i]);
  return {
    position: item.position,
    label: item.label,
    outcome: "simulated",
    message: missing.length ? `Introuvable sur la page : ${missing.join(", ")}` : "Tous les champs ciblés sont visibles",
  };
}

async function fillItem(item: SessionExportItem, page: PageAdapter, cfg: SelectorConfig, hooks: RunnerHooks): Promise<ItemReport> {
  const base = { position: item.position, label: item.label };
  const searches = item.searchStrings.length ? item.searchStrings : [item.label];
  let chosen: { index: number; exact: boolean } | null = null;
  let titles: string[] = [];

  for (const q of searches.slice(0, 3)) {
    if (!(await page.fill(cfg.searchInput, q, cfg.timing.keystroke))) throw new Error("Champ de recherche introuvable (voir selectors.ts)");
    await page.sleep(cfg.timing.afterSearch);
    await page.waitFor(cfg.resultRow, cfg.timing.resultsTimeout);
    titles = page.readResults(cfg);
    chosen = pickResult(titles, { title: item.title, subject: item.manualFields?.subject, number: item.manualFields?.number });
    if (chosen) break;
  }

  let chosenTitle: string | null = null;
  let outcome: ItemReport["outcome"] = "filled";
  if (chosen) {
    await page.chooseResult(cfg, chosen.index);
    chosenTitle = titles[chosen.index] ?? null;
    if (!chosen.exact) outcome = "filled_manual_choice";
  }
  if (!chosen || !chosen.exact) {
    // Pas de correspondance exacte : pause, l'utilisateur choisit ou passe par l'ajout manuel.
    page.highlight(cfg.resultRow, "Choisis le bon résultat");
    page.highlight(cfg.manualEntryButton, "ou ajout manuel");
    const msg = chosen
      ? `Résultat probable sélectionné pour la carte ${item.position} (${item.label}) : vérifie-le, corrige si besoin, puis Continuer.`
      : `Aucun résultat exact pour la carte ${item.position} (${item.label}). Choisis le bon résultat, ou fais l'ajout manuel avec les champs préparés, puis Continuer.`;
    const answer = await page.askUser(msg, item);
    page.clearHighlights();
    if (answer.action === "skip") return { ...base, outcome: "skipped", message: "Passé par l'utilisateur" };
    chosenTitle = answer.chosenTitle ?? chosenTitle;
    outcome = chosenTitle ? "filled_manual_choice" : "manual_entry";
  }

  if (item.declaredValue != null) {
    if (!(await page.fill(cfg.declaredValueInput, String(item.declaredValue), cfg.timing.keystroke)))
      throw new Error("Champ de valeur déclarée introuvable (voir selectors.ts)");
  }
  if (cfg.addItemButton) await page.click(cfg.addItemButton);
  if (chosenTitle) await hooks.onConfirmed(item, chosenTitle);
  return { ...base, outcome, chosenTitle: chosenTitle ?? undefined };
}

export function summarize(report: RunReport): string {
  const count = (o: string) => report.items.filter((i) => i.outcome === o).length;
  return [
    `${report.sessionName} — ${report.mode === "simulation" ? "simulation" : "remplissage réel"}`,
    `Remplis automatiquement : ${count("filled")}`,
    `Choix vérifié à la main : ${count("filled_manual_choice")}`,
    `Ajout manuel : ${count("manual_entry")}`,
    `Passés : ${count("skipped")}, erreurs : ${count("error")}${report.mode === "simulation" ? `, simulés : ${count("simulated")}` : ""}`,
    "Rien n'a été validé ni payé : relis la commande, puis valide et paie toi-même.",
  ].join("\n");
}
