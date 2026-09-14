export function uid() {
  return crypto.randomUUID()
}

export function hashPassword(password: string) {
  return sha256Hex('laxmi-v1:' + password)
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function passwordHash(password: string) {
  return sha256Hex('laxmi-v1:' + password)
}

export function nextBillNo(existing: string[]) {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const prefix = `LF-${y}${m}${day}-`
  let max = 0
  for (const b of existing) {
    if (b.startsWith(prefix)) {
      const n = parseInt(b.slice(prefix.length), 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}
