import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Cormorant_Garamond, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
import { parseThemePreference, THEME_COOKIE } from '@/features/theme/theme';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});
const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});
const cormorant = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: '400',
  preload: false,
});

export const metadata: Metadata = {
  title: { default: 'Greenfield', template: '%s · Greenfield' },
  description: 'Design in the open, with an AI agent in a real vector editor.',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${plexSans.variable} ${plexMono.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <ClerkProvider
          taskUrls={{ 'choose-organization': '/session-tasks/choose-organization' }}
          appearance={{
            variables: {
              colorPrimary: 'var(--field)',
              colorBackground: 'var(--panel)',
              colorForeground: 'var(--ink)',
              colorMutedForeground: 'var(--body)',
              colorInput: 'var(--raise)',
              colorInputForeground: 'var(--ink)',
              colorNeutral: 'var(--ink)',
              colorDanger: 'var(--danger)',
              colorPrimaryForeground: 'var(--ground)',
              borderRadius: '0px',
              fontFamily: 'var(--font-plex-sans)',
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
