import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Scollarly - Live Your Dream | Study Abroad in India",
  description:
    "Scollarly empowers African students with the resources, guidance, and support needed to study in India. We connect students with top institutions and secure scholarships.",
  keywords: [
    "Scollarly",
    "study abroad",
    "study in India",
    "African students",
    "scholarships",
    "university admissions",
    "visa assistance",
    "international education",
  ],
  authors: [{ name: "Scollarly" }],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Scollarly - Live Your Dream",
    description:
      "Empowering African students to study abroad in India with world-class education and scholarship opportunities.",
    type: "website",
    url: "https://scollarly.vercel.app",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
