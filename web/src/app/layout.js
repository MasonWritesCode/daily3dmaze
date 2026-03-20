import "./globals.css";

export const metadata = {
  title: "daily3dmaze",
  description: "A retro-inspired daily 3D maze challenge."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
