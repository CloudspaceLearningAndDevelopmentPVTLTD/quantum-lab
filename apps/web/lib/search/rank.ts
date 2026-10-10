/**
 * rank.ts — scoring for the ⌘K palette. No dependencies, by design.
 *
 * The model is a ladder of match tiers, best first:
 *
 *   exact title  >  title prefix  >  exact keyword  >  title substring
 *                >  partial keyword  >  subtitle  >  fuzzy subsequence
 *
 * Each tier is a wide band of scores, so a tier always beats the one below it
 * however good the lower match is. Within a tier the shape of the match breaks
 * the tie: consecutive characters beat scattered ones, and a character sitting
 * at a word boundary beats one buried mid-word. That is what makes "bs" find
 * "The Bloch Sphere" — b and s both start words — rather than some accident.
 *
 * Every result carries the matched character indices into the TITLE so the UI
 * can highlight exactly what the query hit.
 */

import { DEFAULT_DOC_IDS, type SearchDoc, type SearchKind } from './corpus'

export interface SearchResult {
  doc: SearchDoc
  score: number
  /** Indices into `doc.title` that the query matched, ascending. */
  indices: number[]
}

// Tier floors. The gaps are larger than any within-tier bonus can bridge.
const TIER_EXACT = 10_000
const TIER_PREFIX = 8_000
const TIER_SUBSTRING = 6_000
/**
 * An EXACT keyword match sits above title-substring: if a doc lists "hadamard"
 * as a synonym, it is the hadamard thing, and it should beat a challenge merely
 * titled "Undo the Hadamard". Partial keyword matches stay below substring.
 */
const TIER_KEYWORD_EXACT = 7_000
const TIER_KEYWORD = 4_000
const TIER_SUBTITLE = 2_000
const TIER_FUZZY = 500
/** Tiebreak among near-equal fuzzy hits; small enough never to lift a weak match. */
const FEATURED_FUZZY_BONUS = 5

/**
 * A gentle nudge by document kind, used only to settle ties inside a tier.
 * A visualization or lesson is a destination someone means to reach; a gate or
 * preset is a detail. When "bs" matches both "The Bloch Sphere" (a page you go
 * look at) and "Bell State (Φ+)" (a circuit you load), the page wins.
 */
const KIND_WEIGHT: Record<SearchKind, number> = {
  action: 45,
  visualization: 40,
  workbench: 39,
  lesson: 38,
  // A gate is an atomic, precisely-named concept: when someone types its exact
  // name or synonym they usually mean the gate, so it outranks a challenge that
  // merely happens to use one.
  gate: 34,
  challenge: 30,
  exam: 26,
  page: 24,
  preset: 12,
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  return !/[a-z0-9]/.test(text[index - 1])
}

/** Contiguous index range [start, start+length). */
function range(start: number, length: number): number[] {
  const out: number[] = []
  for (let i = 0; i < length; i += 1) out.push(start + i)
  return out
}

interface FuzzyMatch {
  indices: number[]
  score: number
}

/**
 * Greedy subsequence match with a one-step lookahead for boundaries.
 *
 * For each query character we take the earliest occurrence, except that if a
 * later occurrence sits at a word boundary and the earliest does not, we prefer
 * the boundary one — otherwise "bs" over "the bloch sphere" would bind b to the
 * 'b' of "bloch" (fine) but s to the 's' inside... nothing, and initials of
 * multi-word titles would routinely lose to mid-word noise.
 */
function fuzzyMatch(haystack: string, needle: string): FuzzyMatch | null {
  const indices: number[] = []
  let cursor = 0

  for (const char of needle) {
    let found = -1
    let boundaryFound = -1
    for (let i = cursor; i < haystack.length; i += 1) {
      if (haystack[i] !== char) continue
      if (found === -1) found = i
      if (isBoundary(haystack, i)) {
        boundaryFound = i
        break
      }
    }
    const pick = boundaryFound !== -1 ? boundaryFound : found
    if (pick === -1) return null
    indices.push(pick)
    cursor = pick + 1
  }

  // Shape scoring.
  let score = 0
  for (let i = 0; i < indices.length; i += 1) {
    const at = indices[i]
    score += 10
    if (isBoundary(haystack, at)) score += 24
    if (i > 0 && indices[i - 1] === at - 1) score += 18
    if (i > 0) {
      const gap = at - indices[i - 1] - 1
      score -= Math.min(gap, 12)
    }
  }
  // An early first hit and a compact span both read as "more relevant". A
  // leading article is not content, so "The Bloch Sphere" starts at "Bloch".
  const lead = /^(?:the|a|an) /.exec(haystack)
  score -= Math.min(Math.max(indices[0] - (lead ? lead[0].length : 0), 0), 10)
  const span = indices[indices.length - 1] - indices[0] + 1
  score -= Math.min(Math.floor((span - needle.length) / 2), 15)

  return { indices, score }
}

interface KeywordHit {
  score: number
  exact: boolean
}

/** Best score any single keyword can contribute, plus whether it was exact. */
function keywordScore(keywords: string[], query: string): KeywordHit | null {
  let best: number | null = null
  let exact = false
  for (const keyword of keywords) {
    const k = normalize(keyword)
    let score: number | null = null
    if (k === query) {
      score = 300
      exact = true
    }
    else if (k.startsWith(query)) score = 220 - Math.min(k.length - query.length, 40)
    else {
      const at = k.indexOf(query)
      // Only match at the start of a word inside the phrase. A mid-word hit
      // ("bs" inside "observe") is noise, and noise at keyword tier outranks a
      // genuine fuzzy title match, which is exactly the wrong outcome.
      if (at > 0 && isBoundary(k, at)) {
        score = 160 - Math.min(k.length - query.length, 40)
      }
    }
    if (score !== null && (best === null || score > best)) best = score
  }
  return best === null ? null : { score: best, exact }
}

function scoreDoc(doc: SearchDoc, query: string): SearchResult | null {
  const title = normalize(doc.title)
  const subtitle = normalize(doc.subtitle)
  const weight = KIND_WEIGHT[doc.kind]

  // 1. Exact title.
  if (title === query) {
    return { doc, score: TIER_EXACT + weight, indices: range(0, doc.title.length) }
  }

  // 2. Title prefix — shorter titles win, since the query covers more of them.
  if (title.startsWith(query)) {
    const coverage = Math.round((query.length / title.length) * 200)
    return { doc, score: TIER_PREFIX + coverage + weight, indices: range(0, query.length) }
  }

  const kw = keywordScore(doc.keywords, query)

  // 3. Exact keyword — this document *is* the thing that was typed.
  if (kw?.exact) {
    return { doc, score: TIER_KEYWORD_EXACT + weight, indices: [] }
  }

  // 4. Title substring, with a bonus when it starts a word.
  const at = title.indexOf(query)
  if (at > 0) {
    const boundary = isBoundary(title, at) ? 150 : 0
    const coverage = Math.round((query.length / title.length) * 100)
    return {
      doc,
      score: TIER_SUBSTRING + boundary + coverage + weight - Math.min(at, 40),
      indices: range(at, query.length),
    }
  }

  // 5. Partial keyword hit. No title indices: the match was on a synonym, which
  //    by construction usually does not appear in the title at all.
  if (kw) {
    return { doc, score: TIER_KEYWORD + kw.score + weight, indices: [] }
  }

  // 6. Subtitle hit.
  // Word-start only, for the same reason as keywords above.
  const subAt = subtitle.indexOf(query)
  if (subAt >= 0 && isBoundary(subtitle, subAt)) {
    return { doc, score: TIER_SUBTITLE + weight - Math.min(subAt, 60), indices: [] }
  }

  // 7. Fuzzy subsequence over the title — the safety net for "bs", "qft sim",
  //    and every half-remembered spelling.
  const fuzzy = fuzzyMatch(title, query)
  if (fuzzy) {
    // Initials like "bs" fit many titles equally well ("Band Structure", "The
    // Bloch Sphere"); the curated starting points are the ones people mean.
    const featured = DEFAULT_DOC_IDS.includes(doc.id) ? FEATURED_FUZZY_BONUS : 0
    return { doc, score: TIER_FUZZY + fuzzy.score + weight + featured, indices: fuzzy.indices }
  }

  return null
}

/**
 * Rank `corpus` against `query`, best first.
 *
 * An empty (or whitespace-only) query does NOT return the whole corpus. It
 * returns the curated starting points from `DEFAULT_DOC_IDS`, in that order —
 * with no query there is nothing to rank on, and ninety unranked rows is the
 * same navigation problem the palette exists to solve.
 */
export function search(corpus: SearchDoc[], query: string, limit = 12): SearchResult[] {
  const q = normalize(query.trim())

  if (q.length === 0) {
    const byId = new Map(corpus.map((doc) => [doc.id, doc]))
    const defaults: SearchResult[] = []
    for (const id of DEFAULT_DOC_IDS) {
      const doc = byId.get(id)
      if (doc) defaults.push({ doc, score: 0, indices: [] })
    }
    return defaults.slice(0, limit)
  }

  const scored: SearchResult[] = []
  for (const doc of corpus) {
    const result = scoreDoc(doc, q)
    if (result) scored.push(result)
  }

  scored.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
  return scored.slice(0, limit)
}

export interface SearchGroup {
  kind: SearchKind
  results: SearchResult[]
}

/**
 * Bucket results by kind, preserving rank order inside each bucket. Groups
 * themselves appear in the order their best result did, so the top hit is
 * always in the first section rather than buried under a fixed taxonomy.
 */
export function groupByKind(results: SearchResult[]): SearchGroup[] {
  const groups = new Map<SearchKind, SearchResult[]>()
  for (const result of results) {
    const bucket = groups.get(result.doc.kind)
    if (bucket) bucket.push(result)
    else groups.set(result.doc.kind, [result])
  }
  return [...groups.entries()].map(([kind, list]) => ({ kind, results: list }))
}
