export const WHATSAPP_NUMBER = '237651232301'
export const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`

export const whatsappUrl = (message: string): string =>
  `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`
