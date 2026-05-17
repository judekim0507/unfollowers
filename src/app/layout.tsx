import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Unfollowers - IGUF",
  description: "Check who unfollowed you on Instagram.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="scroll-smooth touch-manipulation">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground min-h-dvh flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="relative isolate flex flex-1 min-h-dvh flex-col">
            <main className="mx-auto w-full max-w-2xl sm:border-x border-dotted px-4 sm:px-8 pt-16 pb-16 flex flex-1 flex-col gap-12 border-border">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
