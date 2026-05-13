import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matter Stats",
  description: "Private reading analytics dashboard for Matter.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
