"use client";

import QRCode from "qrcode";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../_components/client";

interface Net {
  protocol: string;
  port: string;
  host: string;
  addresses: string[];
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 220 }).then(setSrc);
  }, [text]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={text} width={220} height={220} style={{ background: "#fff", borderRadius: 8 }} /> : null;
}

export default function PhonePage() {
  const [net, setNet] = useState<Net | null>(null);
  const [path, setPath] = useState("/");
  useEffect(() => {
    api<Net>("/api/network").then(setNet);
    const s = new URLSearchParams(location.search).get("session");
    if (s) setPath(`/scan/${s}`);
  }, []);

  const https = net?.protocol === "https";
  const tunnel = net && !/^(localhost|127\.|192\.168\.|10\.|172\.)/.test(net.host);
  const urls = tunnel ? [`${location.origin}${path}`] : (net?.addresses ?? []).map((a) => `${net!.protocol}://${a}:${net!.port}${path}`);

  return (
    <>
      <h1>Scanner avec le téléphone</h1>
      <p className="muted">
        Le logiciel tourne sur ton ordinateur ; le téléphone ne sert que de caméra et d'écran, via son navigateur. Les deux doivent être sur le même Wi-Fi (sauf
        avec un tunnel). Rien n'est à installer sur le téléphone.
      </p>

      {net && !https && !tunnel && (
        <div className="panel warn" style={{ marginBottom: 16 }}>
          Cette page est servie en HTTP : un téléphone refusera d'ouvrir la caméra. Arrête l'application et relance-la avec <code>npm run dev:https</code>, ou
          utilise un tunnel (voir plus bas).
        </div>
      )}

      {urls.length > 0 && (
        <>
          <h2>1. Scanne ce code avec l'appareil photo du téléphone</h2>
          <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
            {urls.map((u) => (
              <div key={u} className="stack" style={{ alignItems: "center" }}>
                <Qr text={u} />
                <span className="mono small">{u}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>2. Accepte le certificat (HTTPS local seulement)</h2>
      <div className="panel stack small">
        <div>
          <code>npm run dev:https</code> crée un certificat local. Le téléphone affiche un avertissement la première fois :
        </div>
        <div>
          <b>Android / Chrome</b> : « Paramètres avancés » → « Continuer vers le site ».
        </div>
        <div>
          <b>iPhone / Safari</b> : « Afficher les détails » → « visiter ce site web ». Si la caméra reste bloquée, utilise le tunnel ci-dessous : c'est le plus
          fiable sur iPhone.
        </div>
      </div>

      <h2>Option sans réglage : le tunnel</h2>
      <div className="panel stack small">
        <div>Un tunnel donne une vraie adresse HTTPS, utilisable même hors de ton Wi-Fi. Avec Cloudflare (gratuit, sans compte) :</div>
        <pre className="mono">cloudflared tunnel --url http://localhost:3000</pre>
        <div>
          Ouvre l'adresse <code>https://….trycloudflare.com</code> affichée, sur le téléphone. Le tunnel expose l'application sur Internet : coupe-le (Ctrl+C) après
          le scan.
        </div>
      </div>

      <h2>3. Installation</h2>
      <div className="panel small">
        Téléphone fixé à la verticale au-dessus d'un fond mat sombre (support de type « bras articulé » ou boîte retournée), écran vers toi, lumière diffuse sur
        les côtés. Mets le téléphone en mode « ne pas verrouiller » pendant le scan. Tu peux suivre la revue en même temps sur l'ordinateur.
      </div>
      <p style={{ marginTop: 16 }}>
        <Link href="/">← Sessions</Link>
      </p>
    </>
  );
}
