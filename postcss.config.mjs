// Tailwind is used by the admin routes only (architecture 6, CLAUDE.md: no admin library in a public route). The plugin acts on a
// stylesheet only if it asks for Tailwind (`@import "tailwindcss"`), and only src/app/[locale]/(admin)/admin/admin.css does.
const config = { plugins: { "@tailwindcss/postcss": {} } };

export default config;
