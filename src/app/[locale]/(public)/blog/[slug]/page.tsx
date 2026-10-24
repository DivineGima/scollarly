import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MarkdownView } from "@/components/public/markdown-view";
import { MediaImage } from "@/components/public/media-image";
import { PageLink } from "@/components/public/page-link";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { watDateString } from "@/lib/time";
import { readBlog } from "@/modules/content/read";

// A7 a post: sanitised Markdown, rendered as React elements, never as raw HTML.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const { posts } = await readBlog();
  return posts.map((post) => ({ slug: post.slug }));
}

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = (await readBlog()).posts.find((p) => p.slug === slug);
  return post ? { title: post.title, description: post.excerpt || undefined } : {};
}

export default async function PostPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [t, { posts }] = await Promise.all([getTranslations("blog"), readBlog()]);
  const post = posts.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <article>
      <p>
        <PageLink href="/blog">{t("back")}</PageLink>
      </p>
      <h1>{post.title}</h1>
      <time dateTime={post.publishedAt} className="muted">
        {watDateString(new Date(post.publishedAt))}
      </time>
      {post.cover ? <MediaImage media={post.cover} className="cover cover-large" eager /> : null}
      <MarkdownView source={post.body} />
      <p className="cta-row">
        <WhatsAppButton context={{ page: `/blog/${post.slug}` }} />
      </p>
    </article>
  );
}
