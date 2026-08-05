import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-thai/wght.css";
import "@fontsource-variable/noto-serif-thai/wght.css";
import "./globals.css";

// Resolved at build time so the whole dashboard can be statically generated.
// Vercel injects VERCEL_PROJECT_PRODUCTION_URL for the production domain and
// VERCEL_URL for preview deployments.
function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercelHost ? `https://${vercelHost}` : "http://localhost:3000";
}

export function generateMetadata(): Metadata {
  const base = siteUrl();

  return {
    metadataBase: new URL(base),
    title: "ClearClose — ระบบกระทบยอดบัญชี",
    description: "เห็นทุกยอดต่างก่อนปิดบัญชี ด้วยการกระทบยอดที่ตรวจสอบย้อนกลับได้",
    openGraph: {
      title: "ClearClose — ระบบกระทบยอดบัญชี",
      description: "กระทบยอดชัดเจน ปิดบัญชีมั่นใจ",
      images: [{ url: `${base}/og.png`, width: 1732, height: 902, alt: "ClearClose account reconciliation" }],
    },
    twitter: { card: "summary_large_image", images: [`${base}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
