/**
 * A page's title with one line saying what the page is for (F12, FR-21). Every admin and owner page uses it, so a new admin never has
 * to ask what a screen is. No hooks and no client code: it renders the same on the server and in the browser.
 */
export function PageIntro({ title, purpose, as: Heading = "h1" }: { title: string; purpose: string; as?: "h1" | "h2" }) {
  return (
    <header className="page-intro">
      <Heading>{title}</Heading>
      <p className="page-intro-purpose">{purpose}</p>
    </header>
  );
}
