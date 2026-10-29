/**
 * TOUS les sélecteurs DOM du PSA Online Submission Center sont ici, et seulement ici.
 * Quand PSA modifie son site, c'est le seul fichier à réparer (ou à surcharger depuis le popup, sans recompiler).
 *
 * Ces valeurs par défaut sont des heuristiques génériques : avant le premier vrai remplissage, lance
 * « Inspecter le formulaire » depuis le popup (lecture seule) et ajuste-les à partir du rapport.
 */
export interface SelectorConfig {
  /** Champ de recherche d'item. */
  searchInput: string;
  /** Lignes de résultats de recherche. */
  resultRow: string;
  /** Élément contenant le titre dans une ligne de résultat (relatif à la ligne ; vide = la ligne entière). */
  resultTitle: string;
  /** Élément à cliquer pour choisir un résultat (relatif à la ligne ; vide = la ligne). */
  resultChoose: string;
  /** Indicateur « aucun résultat ». */
  noResults: string;
  /** Champ de valeur déclarée de l'item en cours d'ajout. */
  declaredValueInput: string;
  /** Bouton qui ajoute l'item à la commande (jamais un bouton de validation/paiement : le garde-fou le vérifie). */
  addItemButton: string;
  /** Lien ou bouton d'ajout manuel d'un item absent de la base PSA. */
  manualEntryButton: string;
  /** Champs de l'ajout manuel. */
  manual: { year: string; brand: string; number: string; subject: string; variety: string };
  /** Délais en ms : rythme humain, un item à la fois. */
  timing: { keystroke: number; afterSearch: number; resultsTimeout: number; betweenItems: number };
}

export const DEFAULT_SELECTORS: SelectorConfig = {
  searchInput: 'input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]',
  resultRow: '[role="option"], [role="listbox"] li, [data-testid*="result" i], [class*="result" i] li',
  resultTitle: "",
  resultChoose: "",
  noResults: '[class*="no-result" i], [data-testid*="no-result" i]',
  declaredValueInput: 'input[name*="value" i], input[aria-label*="declared" i], input[placeholder*="value" i]',
  addItemButton: 'button[data-testid*="add" i], button[aria-label*="add item" i]',
  manualEntryButton: 'button[aria-label*="manual" i], a[href*="manual" i]',
  manual: {
    year: 'input[name*="year" i]',
    brand: 'input[name*="brand" i], input[name*="set" i]',
    number: 'input[name*="number" i]',
    subject: 'input[name*="subject" i], input[name*="player" i], input[name*="name" i]',
    variety: 'input[name*="variety" i]',
  },
  timing: { keystroke: 45, afterSearch: 900, resultsTimeout: 8000, betweenItems: 1200 },
};

export function mergeSelectors(override: Partial<SelectorConfig> | null | undefined): SelectorConfig {
  if (!override) return DEFAULT_SELECTORS;
  return {
    ...DEFAULT_SELECTORS,
    ...override,
    manual: { ...DEFAULT_SELECTORS.manual, ...override.manual },
    timing: { ...DEFAULT_SELECTORS.timing, ...override.timing },
  };
}
