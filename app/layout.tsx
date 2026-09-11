import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const graphik = localFont({
  src: [
    { path: './fonts/Graphik-Regular.woff', weight: '400', style: 'normal' },
    { path: './fonts/Graphik-Medium.woff', weight: '500', style: 'normal' },
  ],
  variable: '--font-graphik',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'dry run — pre-flight terrain survey',
  description: 'Check a planned drone mission against modelled terrain in 3D.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${graphik.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
