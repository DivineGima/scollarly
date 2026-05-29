import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getAllPosts, getPostBySlug } from "@/lib/blog";

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Scollarly Blog`,
    description: post.excerpt,
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="mb-10">
          <Link href="/blog" className="text-sm text-blue-600 hover:text-blue-700 font-medium">← Back to Blog</Link>
        </div>

        <header className="mb-12">
          <div className="flex items-center gap-3 mb-5 text-sm text-neutral-500">
            <span>{new Date(post.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
            <span>·</span>
            <span>{post.author}</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-neutral-900 leading-tight mb-5">{post.title}</h1>
          <p className="text-xl text-neutral-600 leading-relaxed">{post.excerpt}</p>
        </header>

        <article className="prose prose-neutral max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-img:rounded-xl prose-blockquote:border-blue-400 prose-blockquote:text-neutral-600">
          <ReactMarkdown>{post.content}</ReactMarkdown>
        </article>

        <div className="mt-16 bg-blue-50 border border-blue-200 rounded-2xl p-8 text-center">
          <h3 className="text-xl font-bold text-neutral-900 mb-2">Ready to apply?</h3>
          <p className="text-neutral-600 mb-6">Scollarly guides you from application to landing in India — 100% free.</p>
          <Link href="/#contact" className="inline-flex items-center justify-center gap-2 px-8 h-12 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all duration-300 hover:-translate-y-0.5">
            Start Your Application →
          </Link>
        </div>

        <div className="mt-10 pt-8 border-t border-neutral-200 text-sm text-neutral-500">
          <Link href="/blog" className="hover:text-blue-600 transition-colors">← All Articles</Link>
          <span className="mx-4">·</span>
          <Link href="/" className="hover:text-blue-600 transition-colors">Back to Scollarly</Link>
        </div>
      </div>
    </div>
  );
}
