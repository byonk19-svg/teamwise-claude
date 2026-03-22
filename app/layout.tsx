import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Teamwise",
  description: "RT Department Scheduling",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Teamwise",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(geistSans.variable, geistMono.variable)}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
