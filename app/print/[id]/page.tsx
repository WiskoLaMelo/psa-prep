import { notFound } from "next/navigation";
import { getDb } from "@/lib/server";
import { getSession, listItems } from "@/core/session/service";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const STATUS = { green: "Confirmé", orange: "Déduit", red: "Set inconnu" } as const;

/** Liste imprimable dans l'ordre de la pile, pour l'emballage. */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const session = getSession(db, id);
  if (!session) notFound();
  const items = listItems(db, id);
  const total = items.reduce((s, i) => s + (i.declaredValue ?? 0), 0);
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <PrintButton />
      </div>
      <h1>{session.name}</h1>
      <p className="muted small">
        {items.length} cartes · valeur déclarée totale {total} $ · ordre de la pile : 1 = carte du dessus · imprimé le {new Date().toLocaleDateString("fr-FR")}
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Carte</th>
            <th>Référence PSA</th>
            <th>Statut</th>
            <th>Valeur</th>
            <th>✓</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <b>{i.position}</b>
              </td>
              <td>
                {i.identity ? (
                  <>
                    {i.identity.name}
                    <div className="small muted">
                      {i.identity.setName} #{i.identity.number} · {i.identity.lang.toUpperCase()}
                      {i.identity.variant !== "base" ? ` · ${i.identity.variant}` : ""}
                    </div>
                  </>
                ) : (
                  <span className="muted">Non identifiée</span>
                )}
              </td>
              <td className="small">{i.psa?.title ?? i.psa?.searchStrings[0] ?? ""}</td>
              <td className="small">{i.psa ? STATUS[i.psa.status] : ""}</td>
              <td>{i.declaredValue ?? ""}</td>
              <td style={{ width: 30, borderLeft: "1px solid var(--border)" }} />
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
