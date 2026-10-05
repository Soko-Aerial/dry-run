import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'
import 'mapbox-gl/dist/mapbox-gl.css'

const gerstner = localFont({
  src: [
    { path: './fonts/Gerstner_ProgrammRegular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Gerstner_ProgrammMedium.woff2', weight: '500', style: 'normal' },
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
    <html lang="en" suppressHydrationWarning className={`${gerstner.variable} h-full`}>
      <body className="h-full overflow-hidden antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem={true}>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
