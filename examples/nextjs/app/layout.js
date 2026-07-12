export const metadata = {
  title: 'waconector — exemplo Next.js',
  description: 'Bot mínimo com Next.js (App Router) + waconector.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
