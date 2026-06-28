import { SpeedInsights } from '@vercel/speed-insights/next';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>FiltresBJ AI - GeminiAtlas</title>
      </head>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
