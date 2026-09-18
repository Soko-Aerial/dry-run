import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'
import 'mapbox-gl/dist/mapbox-gl.css'

const graphik = localFont({
  src: [
    { path: './fonts/Graphik-Regular.woff', weight: '400', style: 'normal' },
    { path: './fonts/Graphik-Medium.woff', weight: '500', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'dry run — pre-flight terrain survey',
  description: 'Check a planned drone mission against modelled terrain in 3D.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${graphik.variable} h-full`}>
      <body className="h-full overflow-hidden antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
