/**
 * Inspection en lecture seule du formulaire PSA : liste les champs, boutons et listes répétées,
 * avec un sélecteur proposé pour chacun. Ne clique sur rien, ne saisit rien, n'envoie rien.
 * Les champs sensibles (mot de passe, carte bancaire) sont exclus et leurs valeurs ne sont jamais lues.
 */
import { isForbiddenField } from "./guard";

function cssPath(el: Element): string {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;
  const name = el.getAttribute("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
  const aria = el.getAttribute("aria-label");
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria}"]`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && parts.length < 4 && cur !== document.body) {
    const tag = cur.tagName.toLowerCase();
    const cls = [...cur.classList].filter((c) => !/^\d|[:[\]]/.test(c)).slice(0, 2);
    parts.unshift(cls.length ? `${tag}.${cls.join(".")}` : tag);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

function labelOf(el: Element): string {
  const id = el.getAttribute("id");
  const lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest("label");
  return (lab?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function inspectPage() {
  const fields = [...document.querySelectorAll("input, select, textarea")]
    .filter((el) => !isForbiddenField(el) && (el as HTMLInputElement).type !== "hidden")
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.getAttribute("id"),
      placeholder: el.getAttribute("placeholder"),
      ariaLabel: el.getAttribute("aria-label"),
      label: labelOf(el),
      selector: cssPath(el),
    }));
  const buttons = [...document.querySelectorAll('button, [role="button"], a[href], input[type="submit"]')].slice(0, 150).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    ariaLabel: el.getAttribute("aria-label"),
    selector: cssPath(el),
  }));
  // Listes répétées : candidats pour les lignes de résultats de recherche.
  const counts = new Map<string, number>();
  document.querySelectorAll("li, [role='option'], [role='row'], div[class]").forEach((el) => {
    const key = cssPath(el).split(" > ").slice(-2).join(" > ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const repeated = [...counts.entries()].filter(([, n]) => n >= 3 && n <= 200).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([selector, count]) => ({ selector, count }));
  return { url: location.href, title: document.title, at: new Date().toISOString(), fields, buttons, repeated };
}
