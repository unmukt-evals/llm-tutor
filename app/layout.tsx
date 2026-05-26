import type { ReactNode } from 'react';

export const metadata = {
  title: 'LLM Tutor',
  description: 'Local-first LLM curriculum tutor.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
