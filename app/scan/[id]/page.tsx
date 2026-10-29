"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AutoCapture, DEFAULT_STABILITY, meanAbsDiff, toGray } from "@/core/capture/stability";
import type { SessionItemView } from "@/core/session/service";
import { api, imageUrl } from "../../_components/client";
import { StatusPill } from "../../_components/ui";

const ANALYSIS_W = 64;
const ANALYSIS_H = 48;

type Upload = { blob: Blob; side: "front" | "back"; tries: number };

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    osc.onended = () => ctx.close();
  } catch {
    // Pas d'audio disponible : on se contente de la vibration et du flash.
  }
  navigator.vibrate?.(60);
}

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrame = useRef<Uint8Array | null>(null);
  const lastCaptureFrame = useRef<Uint8Array | null>(null);
  const background = useRef<Uint8Array | null>(null);
  const auto = useRef(new AutoCapture(DEFAULT_STABILITY));
  const uploads = useRef<Upload[]>([]);
  const uploading = useRef(false);
  const nextSide = useRef<"front" | "back">("front");

  const [sessionName, setSessionName] = useState("");
  const [items, setItems] = useState<SessionItemView[]>([]);
  const [pendingIdent, setPendingIdent] = useState(0);
  const [queued, setQueued] = useState(0);
  const [netError, setNetError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(true);
  const [rectoVerso, setRectoVerso] = useState(false);
  const [state, setState] = useState<"waiting" | "settling" | "captured">("waiting");
  const [progress, setProgress] = useState(0);
  const [flash, setFlash] = useState(false);
  const [resolution, setResolution] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [hasBackground, setHasBackground] = useState(false);

  // Délai de stabilité configuré dans .env.
  useEffect(() => {
    api<{ captureStableMs: number }>("/api/config")
      .then((c) => (auto.current.opts = { ...auto.current.opts, stableMs: c.captureStableMs }))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    api<{ session: { name: string }; items: SessionItemView[]; pending: number }>(`/api/sessions/${id}`)
      .then((d) => {
        setSessionName(d.session.name);
        setItems(d.items);
        setPendingIdent(d.pending);
      })
      .catch(() => {});
  }, [id]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // Caméra arrière en résolution maximale.
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Caméra indisponible : ouvre la page en HTTPS ou sur localhost (voir le guide).");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 4096 }, height: { ideal: 3072 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } },
        });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const s = stream.getVideoTracks()[0]?.getSettings();
        setResolution(s?.width ? `${s.width}×${s.height}` : "");
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
        setCamError(null);
      } catch (e) {
        setCamError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [deviceId]);

  // Envoi séquentiel : l'ordre d'arrivée sur le serveur = l'ordre de la pile.
  const pump = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      while (uploads.current.length) {
        const u = uploads.current[0]!;
        const form = new FormData();
        form.append("image", u.blob, "capture.jpg");
        form.append("side", u.side);
        try {
          const res = await fetch(`/api/sessions/${id}/captures`, { method: "POST", body: form });
          if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
          uploads.current.shift();
          setNetError(null);
        } catch (e) {
          u.tries++;
          setNetError(`Envoi en attente (${e instanceof Error ? e.message : e}) — nouvel essai…`);
          await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** Math.min(u.tries, 4))));
        }
        setQueued(uploads.current.length);
      }
    } finally {
      uploading.current = false;
      refresh();
    }
  }, [id, refresh]);

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const side = rectoVerso ? nextSide.current : "front";
    nextSide.current = rectoVerso && side === "front" ? "back" : "front";
    c.toBlob(
      (blob) => {
        if (!blob) return;
        uploads.current.push({ blob, side, tries: 0 });
        setQueued(uploads.current.length);
        void pump();
      },
      "image/jpeg",
      0.92,
    );
    lastCaptureFrame.current = prevFrame.current;
    auto.current.markCaptured();
    beep();
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }, [pump, rectoVerso]);

  // Analyse de l'image ~10 fois par seconde en basse résolution.
  useEffect(() => {
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      analysisRef.current ??= Object.assign(document.createElement("canvas"), { width: ANALYSIS_W, height: ANALYSIS_H });
      const ctx = analysisRef.current.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, ANALYSIS_W, ANALYSIS_H);
      const gray = toGray(ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data);
      const now = performance.now();
      const metrics = {
        motion: prevFrame.current ? meanAbsDiff(gray, prevFrame.current) : 255,
        diffFromLastCapture: lastCaptureFrame.current ? meanAbsDiff(gray, lastCaptureFrame.current) : null,
        diffFromBackground: background.current ? meanAbsDiff(gray, background.current) : null,
      };
      prevFrame.current = gray;
      if (autoOn && auto.current.update(metrics, now)) capture();
      else if (!autoOn && auto.current.state !== "captured") auto.current.state = "waiting";
      setState(auto.current.state);
      setProgress(auto.current.progress(now));
    }, 100);
    return () => clearInterval(t);
  }, [autoOn, capture]);

  const undo = useCallback(async () => {
    if (uploads.current.length) {
      uploads.current.pop();
      setQueued(uploads.current.length);
    } else {
      await fetch(`/api/sessions/${id}/captures`, { method: "DELETE" });
    }
    if (rectoVerso) nextSide.current = nextSide.current === "front" ? "back" : "front";
    refresh();
  }, [id, rectoVerso, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        capture();
      } else if (e.key === "Backspace" || e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
      } else if (e.key.toLowerCase() === "a") setAutoOn((x) => !x);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, undo]);

  const fronts = items.length;
  const last = [...items].reverse().find((i) => i.identity || i.captureStatus === "error");
  const ringColor = state === "captured" ? "var(--green)" : state === "settling" ? "var(--orange)" : "rgba(255,255,255,.6)";

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>
          Scan — {sessionName}
        </h1>
        <Link className="btn primary" href={`/review/${id}`}>
          Terminer → revue
        </Link>
      </div>
      {camError && <div className="panel err" style={{ marginBottom: 12 }}>{camError}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)", gap: 16 }} className="scan-grid">
        <div style={{ position: "relative", background: "#000", borderRadius: 10, overflow: "hidden" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block" }} />
          {/* Cadre-guide au format carte (63 × 88 mm). */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              height: "86%",
              aspectRatio: "63 / 88",
              transform: "translate(-50%, -50%)",
              border: `3px solid ${ringColor}`,
              borderRadius: 14,
              boxShadow: "0 0 0 9999px rgba(0,0,0,.25)",
              transition: "border-color .15s",
            }}
          />
          {state === "settling" && (
            <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${progress * 100}%`, background: "var(--orange)" }} />
          )}
          {flash && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.6)" }} />}
          <div style={{ position: "absolute", top: 10, left: 10, color: "#fff", fontSize: 13, textShadow: "0 1px 2px #000" }}>
            {resolution} · {autoOn ? (state === "captured" ? "Retire ou change la carte" : state === "settling" ? "Ne bouge plus…" : "Pose une carte") : "Capture manuelle"}
            {rectoVerso && ` · prochaine : ${nextSide.current === "front" ? "recto" : "verso"}`}
          </div>
          <div style={{ position: "absolute", top: 8, right: 12, color: "#fff", fontSize: 40, fontWeight: 800, textShadow: "0 1px 4px #000" }}>{fronts + queued}</div>
        </div>
        <div className="stack">
          <div className="panel stack">
            <button className="primary" onClick={capture} style={{ justifyContent: "center", padding: 12 }}>
              Capturer (Espace)
            </button>
            <button onClick={() => void undo()}>Annuler la dernière (Z)</button>
            <label className="row small">
              <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} /> Capture automatique (A)
            </label>
            <label className="row small">
              <input
                type="checkbox"
                checked={rectoVerso}
                onChange={(e) => {
                  setRectoVerso(e.target.checked);
                  nextSide.current = "front";
                }}
              />{" "}
              Recto/verso (2 photos par carte)
            </label>
            <button
              className="small"
              onClick={() => {
                background.current = prevFrame.current;
                setHasBackground(true);
              }}
              title="Vise le fond sans carte puis clique : la capture ne se déclenchera jamais sur le fond vide."
            >
              {hasBackground ? "Fond vide mémorisé ✓" : "Mémoriser le fond vide"}
            </button>
            {devices.length > 1 && (
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Caméra par défaut</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId.slice(0, 8)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="panel small stack">
            <div>
              <b>{fronts}</b> cartes enregistrées · {queued > 0 ? `${queued} en envoi · ` : ""}
              {pendingIdent > 0 ? `${pendingIdent} en identification` : "identification à jour"}
            </div>
            {netError && <div className="warn">{netError}</div>}
          </div>
          {last && (
            <div className="panel stack">
              <div className="muted small">Dernier résultat — carte {last.position}</div>
              <div className="row" style={{ alignItems: "flex-start" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {last.frontImageHash && <img src={imageUrl(last.frontImageHash, 160)!} alt="" style={{ width: 80, borderRadius: 6 }} />}
                <div className="stack grow" style={{ gap: 4 }}>
                  {last.identity ? (
                    <>
                      <b>{last.identity.name}</b>
                      <span className="small muted">
                        {last.identity.setName} #{last.identity.number} · {last.identity.lang.toUpperCase()} · {Math.round(last.identity.confidence * 100)} %
                      </span>
                      <StatusPill status={last.psa?.status} />
                    </>
                  ) : (
                    <span className="err">{last.captureError}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <p className="muted small">
            Installation : caméra fixe à la verticale, fond mat sombre, lumière diffuse sur les côtés. Cartes nues ou en penny sleeve. Jamais de
            scanner à chargeur.
          </p>
        </div>
      </div>
      <style>{`@media (max-width: 760px) { .scan-grid { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
