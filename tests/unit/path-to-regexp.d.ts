// Next.js vendors path-to-regexp without type declarations. The i18n rewrite test uses the same matcher Next.js uses for rewrites.
declare module "next/dist/compiled/path-to-regexp" {
  export function match(path: string, options?: { decode?: (value: string) => string }): (input: string) => false | { params: Record<string, string> };
  export function compile(path: string, options?: { validate?: boolean }): (params: Record<string, string>) => string;
}
