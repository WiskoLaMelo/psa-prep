/**
 * Garde-fou : l'extension ne clique JAMAIS sur valider, payer, confirmer ou passer commande,
 * et ne touche à aucun identifiant ni moyen de paiement. Chaque clic et chaque saisie passent par ici.
 */
const FORBIDDEN_TEXT =
  /\b(submit|pay|payment|checkout|check out|confirm|place order|complete order|purchase|buy|valider|payer|paiement|confirmer|commander|acheter|log ?in|sign ?in|password)\b/i;

const FORBIDDEN_FIELD = /pass(word)?|card.?number|cc-|cvc|cvv|expir|iban|login|username|email/i;

export interface ElementLike {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  closest?(selector: string): ElementLike | null;
}

function describe(el: ElementLike): string {
  return [el.textContent, el.getAttribute("aria-label"), el.getAttribute("value"), el.getAttribute("title"), el.getAttribute("name"), el.getAttribute("id")]
    .filter(Boolean)
    .join(" ");
}

export function isForbiddenClick(el: ElementLike): boolean {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "submit" && el.tagName.toLowerCase() === "input") return true;
  if (FORBIDDEN_TEXT.test(describe(el))) return true;
  // Tout ce qui se trouve dans un formulaire de paiement ou de connexion est hors limites.
  if (el.closest?.('form[action*="pay" i], form[action*="checkout" i], form[action*="login" i], [class*="payment" i], [id*="payment" i]')) return true;
  return false;
}

export function isForbiddenField(el: ElementLike): boolean {
  const attrs = [el.getAttribute("type"), el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("autocomplete"), el.getAttribute("aria-label")].join(" ");
  return (el.getAttribute("type") ?? "").toLowerCase() === "password" || FORBIDDEN_FIELD.test(attrs);
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export function assertClickable(el: ElementLike) {
  if (isForbiddenClick(el)) throw new GuardError(`Clic refusé par le garde-fou : « ${describe(el).slice(0, 80)} »`);
}

export function assertFillable(el: ElementLike) {
  if (isForbiddenField(el)) throw new GuardError("Saisie refusée par le garde-fou : champ sensible (identifiant ou paiement)");
}
