import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Bahiano da 99 | Central de Atendimento",
  description: "Painel privado de atendimento, produção e vendas",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
