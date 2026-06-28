import './globals.css';

export const metadata = {
  title: 'Ferie — restplasser',
  description: 'Current cheap last-minute package deals from OSL (Apollo)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
