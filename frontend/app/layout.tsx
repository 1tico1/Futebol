import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Futebol — Previsões",
  description: "Dashboard de probabilidades para Brasileirão e Libertadores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
