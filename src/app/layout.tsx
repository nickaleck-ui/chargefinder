import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChargeFinder — EV Charge Planner",
  description: "Find DC fast charging stations near you and calculate time to 80% based on your vehicle and current battery level.",
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "ChargeFinder",
    description: "EV charge planner — find nearby DC fast chargers and estimate charge time to 80%.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"
        />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Bebas+Neue&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
