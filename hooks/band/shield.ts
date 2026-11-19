const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
// 010-1234-5678, 010 1234 5678, 01012345678, 02-123-4567, 031-123-4567, 070-/080-, 0505-, +82 10-1234-5678:
// a Korean mobile, area, internet-phone, toll-free or safe-number prefix, hyphens, spaces or nothing between, not part of a longer run of digits.
const PHONE = /(?<![\d.-])(?:\+82[-\s]?|0)(?:1[016789]|2|[3-6][1-5]|70|80|50\d)[-\s]?\d{3,4}[-\s]?\d{4}(?![\d-])/g

/** Draw-time masking only: emails and Korean phone numbers, code blocks included. */
export const maskText = (text: string) => text.replace(EMAIL, '●●@가림').replace(PHONE, '●●● 가림')
