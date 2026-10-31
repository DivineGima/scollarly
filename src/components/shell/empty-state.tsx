/**
 * What a list shows when it is empty (FR-21): not "No data" but what the person can do next. The action is a plain link, so it works
 * with no script and goes through the same one WhatsApp helper or screen address as everywhere else.
 */
export function EmptyState({ title, next, action }: { title: string; next: string; action?: { href: string; label: string } }) {
  return (
    <section className="empty-state" aria-live="polite">
      <h2>{title}</h2>
      <p>{next}</p>
      {action ? (
        <a className="empty-state-action" href={action.href}>
          {action.label}
        </a>
      ) : null}
    </section>
  );
}
