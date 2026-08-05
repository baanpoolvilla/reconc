import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/noto-sans-thai/wght.css";
import "@fontsource-variable/noto-serif-thai/wght.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = `${protocol}://${host}`;

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
