import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface Post {
  title: string;
  date: string;
  slug: string;
  excerpt: string;
  author: string;
  content: string;
}

const postsDir = path.join(process.cwd(), "content/blog");

export function getAllPosts(): Post[] {
  if (!fs.existsSync(postsDir)) return [];
  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith(".md"));
  return files
    .map((filename) => {
      const slug = filename.replace(/\.md$/, "");
      const fullPath = path.join(postsDir, filename);
      const raw = fs.readFileSync(fullPath, "utf8");
      const { data, content } = matter(raw);
      return { slug, content, ...(data as Omit<Post, "slug" | "content">) };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPostBySlug(slug: string): Post | null {
  const fullPath = path.join(postsDir, `${slug}.md`);
  if (!fs.existsSync(fullPath)) return null;
  const raw = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(raw);
  return { slug, content, ...(data as Omit<Post, "slug" | "content">) };
}
