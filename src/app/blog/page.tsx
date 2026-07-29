import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog, Scollarly | Study in India from Africa",
  description: "Guides, tips, and stories for African students planning to study in India. University reviews, visa guides, and student experiences.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="mb-10">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">← Back to Home</Link>
        </div>

        <div className="mb-14">
          <span className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold bg-blue-100 text-blue-700 mb-4">Our Blog</span>
          <h1 className="text-4xl sm:text-5xl font-bold text-neutral-900 mb-4">Guides for Students Like You</h1>
          <p className="text-lg text-neutral-600 max-w-2xl">Everything you need to know about studying in India, from choosing a university to getting your visa and settling in.</p>
        </div>

        {posts.length === 0 ? (
          <p className="text-neutral-500">No posts yet. Check back soon.</p>
        ) : (
          <div className="space-y-8">
            {posts.map((post) => (
              <article key={post.slug} className="group bg-white border border-neutral-200 rounded-2xl p-8 hover:border-blue-300 hover:shadow-lg transition-all duration-300">
                <div className="flex items-center gap-3 mb-4 text-sm text-neutral-500">
                  <span>{new Date(post.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
                  <span>·</span>
                  <span>{post.author}</span>
                </div>
                <h2 className="text-2xl font-bold text-neutral-900 mb-3 group-hover:text-blue-600 transition-colors leading-tight">
                  <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                </h2>
                <p className="text-neutral-600 leading-relaxed mb-5">{post.excerpt}</p>
                <Link href={`/blog/${post.slug}`} className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm hover:gap-3 transition-all duration-200">
                  Read the full guide →
                </Link>
              </article>
            ))}
          </div>
        )}

        <div className="mt-20 bg-blue-50 border border-blue-200 rounded-2xl p-8 text-center">
          <h3 className="text-xl font-bold text-neutral-900 mb-2">Ready to start your journey?</h3>
          <p className="text-neutral-600 mb-6">Our counsellors are ready to help, for free.</p>
          <Link href="/#contact" className="inline-flex items-center justify-center gap-2 px-8 h-12 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all duration-300 hover:-translate-y-0.5">
            Get Free Guidance →
          </Link>
        </div>
      </div>
    </div>
  );
}
