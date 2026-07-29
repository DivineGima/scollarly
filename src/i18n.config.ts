import { getRequestConfig } from 'next-intl/server'

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale
  const resolvedLocale = locale ?? 'en'
  return {
    locale: resolvedLocale,
    messages: (await import(`../messages/${resolvedLocale}.json`)).default,
  }
})
