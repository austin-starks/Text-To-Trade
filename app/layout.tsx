import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { WalletIndicator } from "./components/WalletIndicator";
import "./globals.css";
import { Providers } from "./providers";
import { ErudaProvider } from "./providers/erudaProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Text-To-Trade | Natural Language Trading on Base",
  description: "Swap tokens on Base using plain English. Just type 'swap 100 USDC for ETH' or 'ape into DEGEN' and execute trades instantly via 1inch.",
  metadataBase: new URL('https://text-to-trade.vercel.app'),
  keywords: ["base", "farcaster", "mini app", "trading", "defi", "swap", "1inch", "natural language", "ai"],
  openGraph: {
    title: "Text-To-Trade | Natural Language Trading on Base",
    description: "Trade on Base using natural language. Powered by AI and 1inch.",
    url: "https://text-to-trade.vercel.app",
    siteName: "Text-To-Trade",
    images: [
      {
        url: "/hero.png",
        width: 1200,
        height: 630,
        alt: "Text-To-Trade - Natural Language Trading on Base"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Text-To-Trade | Natural Language Trading on Base",
    description: "Trade on Base using natural language. Powered by AI and 1inch.",
    images: ["/hero.png"]
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png"
  },
  other: {
    "base:app_id": "69692b388b0e0e7315e206f0",
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: "https://text-to-trade.vercel.app/hero.png",
      button: {
        title: "Start Trading",
        action: {
          type: "launch_miniapp",
          url: "https://text-to-trade.vercel.app",
          name: "Text-To-Trade",
          splashImageUrl: "https://text-to-trade.vercel.app/splash.png",
          splashBackgroundColor: "#0d1117"
        }
      }
    })
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <ErudaProvider />
      </head>
      <body
        className={`${inter.variable} antialiased`}
      >
        <Providers>
          <WalletIndicator />
          {children}
        </Providers>
      </body>
    </html>
  );
}
