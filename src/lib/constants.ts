export const WHATSAPP_NUMBER = '919815725968'
export const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`

export const whatsappUrl = (message: string): string =>
  `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`
