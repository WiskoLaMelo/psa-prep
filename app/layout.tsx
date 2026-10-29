import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "PSA Prep", description: "Préparation de submissions PSA" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            PSA Prep
          </Link>
          <nav>
            <Link href="/">Sessions</Link>
            <Link href="/mappings">Correspondances PSA</Link>
            <Link href="/catalog">Catalogue</Link>
            <Link href="/phone">Téléphone</Link>
            <Link href="/setup">Réglages</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
