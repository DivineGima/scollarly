/** Copy for a content block: blank lines separate paragraphs, so the owner writes plain text and the page never trusts markup. */
export function Paragraphs({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => (
        <p key={index} className={className}>
          {part}
        </p>
      ))}
    </>
  );
}
