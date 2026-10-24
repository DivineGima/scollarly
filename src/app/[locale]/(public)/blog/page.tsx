import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MediaImage } from "@/components/public/media-image";
import { pageMetadata } from "@/components/public/page-metadata";
import { watDateString } from "@/lib/time";
import { readBlog } from "@/modules/content/read";

// A7 the list: posts with a cover image and a date.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "blog");
}

export default async function BlogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { posts }] = await Promise.all([getTranslations("blog"), readBlog()]);

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {posts.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="grid cards">
          {posts.map((post) => (
            <li key={post.slug} className="card">
              <a href={`/blog/${post.slug}`} className="card-link">
                {post.cover ? <MediaImage media={post.cover} className="cover" /> : null}
                <strong>{post.title}</strong>
                <time dateTime={post.publishedAt} className="muted block">
                  {watDateString(new Date(post.publishedAt))}
                </time>
                {post.excerpt ? <span className="block">{post.excerpt}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
