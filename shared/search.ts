/** Shared search tokens. Every token must match, as a prefix of a word. */

export function searchTokens(value: string): string[] | null {
  const cleaned = value
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.replace(/\s/g, '').length < 3) return null
  const tokens = cleaned
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  return tokens.length > 0 ? tokens : null
}

export function wordList(...parts: Array<string | null | undefined>): string[] {
  const words = new Set<string>()
  for (const part of parts) {
    if (!part) continue
    for (const word of part.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word) words.add(word)
    }
  }
  return [...words]
}

export function matchesAllTokens(tokens: string[], ...parts: Array<string | null | undefined>): boolean {
  const words = wordList(...parts)
  return tokens.every((token) => words.some((word) => word.startsWith(token)))
}

export function relevanceScore(tokens: string[], fields: { text: string; weight: number }[]): number {
  let score = 0
  for (const token of tokens) {
    let best = 0
    for (const field of fields) {
      for (const word of wordList(field.text)) {
        if (word === token) best = Math.max(best, 10 * field.weight)
        else if (word.startsWith(token)) best = Math.max(best, 4 * field.weight + Math.min(token.length, 8))
      }
    }
    score += best
  }
  return score
}
