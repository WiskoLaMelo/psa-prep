import type { RunReport, SessionExportItem } from "./types";
import { summarize } from "./runner";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Petit panneau flottant dans la page PSA : avancement, pauses, rapport. Aucun accès aux champs PSA. */
class Overlay {
  private root: HTMLDivElement | null = null;
  private tags: HTMLElement[] = [];
  stopRequested = false;
  getSelectedTitle: () => string | null = () => null;

  private ensure(): HTMLDivElement {
    if (this.root?.isConnected) return this.root;
    const d = document.createElement("div");
    d.id = "psa-prep-overlay";
    Object.assign(d.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      width: "360px",
      maxHeight: "70vh",
      overflow: "auto",
      zIndex: "2147483647",
      background: "#1e1d1b",
      color: "#ecebe7",
      font: "13px/1.4 system-ui, sans-serif",
      borderRadius: "10px",
      boxShadow: "0 6px 24px rgba(0,0,0,.35)",
      padding: "12px",
    });
    document.body.appendChild(d);
    this.root = d;
    return d;
  }

  private render(html: string) {
    const r = this.ensure();
    r.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>PSA Prep</b><button data-act="stop" style="font:inherit;background:#3a1b18;color:#f07b72;border:0;border-radius:6px;padding:3px 8px;cursor:pointer">Arrêter</button></div>${html}`;
    r.querySelector<HTMLButtonElement>('[data-act="stop"]')!.onclick = () => {
      this.stopRequested = true;
      r.querySelector('[data-act="stop"]')!.textContent = "Arrêt après cet item…";
    };
  }

  progress(report: RunReport, current: SessionExportItem | null) {
    const done = report.items.length;
    const last = report.items.slice(-4).reverse();
    this.render(
      `<div>${report.mode === "simulation" ? "Simulation (rien n'est saisi)" : "Remplissage réel"} · ${done} traité(s)</div>` +
        (current ? `<div style="margin:6px 0">En cours : <b>${current.position}. ${esc(current.label)}</b></div>` : "") +
        last.map((i) => `<div style="opacity:.8">${i.position}. ${esc(i.outcome)}${i.message ? ` — ${esc(i.message)}` : ""}</div>`).join("") +
        (report.finishedAt ? `<pre style="white-space:pre-wrap;background:#141412;padding:8px;border-radius:6px;margin-top:8px">${esc(summarize(report))}</pre>` : ""),
    );
  }

  ask(message: string, item: SessionExportItem): Promise<{ action: "continue" | "skip"; chosenTitle: string | null }> {
    const fields = item.manualFields
      ? Object.entries(item.manualFields)
          .filter(([, v]) => v)
          .map(([k, v]) => `<div><span style="opacity:.6">${esc(k)}</span> <code data-copy="${encodeURIComponent(v)}" style="cursor:copy;background:#141412;padding:1px 4px;border-radius:4px">${esc(v)}</code></div>`)
          .join("")
      : "";
    const r = this.ensure();
    const box = document.createElement("div");
    box.style.cssText = "margin-top:10px;padding:10px;background:#35260f;border-radius:8px";
    box.innerHTML = `<div style="margin-bottom:6px">${esc(message)}</div>${fields}
      <div style="margin-top:8px"><input data-title placeholder="Titre PSA choisi (pour l'apprendre)" style="width:100%;font:inherit;padding:4px;border-radius:6px;border:0"></div>
      <div style="display:flex;gap:6px;margin-top:8px"><button data-act="go" style="flex:1;font:inherit;border:0;border-radius:6px;padding:5px;cursor:pointer;background:#6d8ff0">Continuer</button>
      <button data-act="skip" style="font:inherit;border:0;border-radius:6px;padding:5px 10px;cursor:pointer">Passer</button></div>`;
    r.appendChild(box);
    const input = box.querySelector<HTMLInputElement>("[data-title]")!;
    const refresh = setInterval(() => {
      const t = this.getSelectedTitle();
      if (t && !input.dataset.touched) input.value = t;
    }, 500);
    input.oninput = () => (input.dataset.touched = "1");
    box.querySelectorAll<HTMLElement>("[data-copy]").forEach((c) => (c.onclick = () => navigator.clipboard.writeText(decodeURIComponent(c.dataset.copy!))));
    return new Promise((resolve) => {
      box.querySelector<HTMLButtonElement>('[data-act="go"]')!.onclick = () => {
        clearInterval(refresh);
        box.remove();
        resolve({ action: "continue", chosenTitle: input.value.trim() || null });
      };
      box.querySelector<HTMLButtonElement>('[data-act="skip"]')!.onclick = () => {
        clearInterval(refresh);
        box.remove();
        resolve({ action: "skip", chosenTitle: null });
      };
    });
  }

  tag(el: HTMLElement, label: string) {
    const r = el.getBoundingClientRect();
    const t = document.createElement("div");
    t.textContent = label;
    Object.assign(t.style, {
      position: "fixed",
      left: `${Math.max(0, r.left)}px`,
      top: `${Math.max(0, r.top - 22)}px`,
      background: "#f0a64d",
      color: "#000",
      font: "12px system-ui",
      padding: "2px 6px",
      borderRadius: "4px",
      zIndex: "2147483646",
      pointerEvents: "none",
    });
    document.body.appendChild(t);
    this.tags.push(t);
  }

  clearTags() {
    for (const t of this.tags.splice(0)) t.remove();
  }

  show(html: string) {
    this.render(html);
  }
}

export const overlay = new Overlay();
