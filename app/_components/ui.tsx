"use client";

import { useState } from "react";
import { STATUS_LABEL } from "./client";

export function StatusPill({ status }: { status: "green" | "orange" | "red" | null | undefined }) {
  if (!status) return <span className="pill gray">À identifier</span>;
  return <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el!.style.display = "none"), 1800);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Contexte non sécurisé (HTTP sur le réseau local) : repli sur execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copié");
}

export function Copyable({ text, label, mono }: { text: string; label?: string; mono?: boolean }) {
  if (!text) return null;
  return (
    <div className="copy">
      {label && <span className="muted small">{label}</span>}
      <span className={`text ${mono ? "mono" : ""}`}>{text}</span>
      <button type="button" onClick={() => copyText(text)} title="Copier">
        Copier
      </button>
    </div>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="lightbox" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" />
    </div>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run, setErr };
}
