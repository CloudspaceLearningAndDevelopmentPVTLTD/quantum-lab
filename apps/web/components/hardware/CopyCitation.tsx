'use client'

/**
 * CopyCitation — the BibTeX block on a published run page.
 *
 * A client island inside an otherwise fully server-rendered page. It exists
 * only because copying to the clipboard needs a browser: the citation text
 * itself is built on the server by `runBibtex` and passed in, so a reader with
 * JavaScript disabled still sees the entry and can select it by hand. Building
 * it here instead would have made the page's whole point — a citable record —
 * depend on script execution.
 */

import { useCallback, useState } from 'react'

export interface CopyCitationProps {
  /** The BibTeX entry, built server-side by `runBibtex`. */
  bibtex: string
  /** The canonical permalink, offered as the plain-URL alternative. */
  url: string
}

export function CopyCitation({ bibtex, url }: CopyCitationProps) {
  const [copied, setCopied] = useState<'bibtex' | 'url' | null>(null)

  const copy = useCallback((text: string, which: 'bibtex' | 'url') => {
    // `navigator.clipboard` is undefined over plain http on some browsers and
    // can reject when the document is not focused. Either way the entry is
    // still on screen and selectable, so a failure resets the label rather
    // than raising anything at the reader.
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(which),
      () => setCopied(null)
    )
  }, [])

  return (
    <div>
      <pre className="code-block mt-3 overflow-x-auto text-[12px]">{bibtex}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copy(bibtex, 'bibtex')}
          className="btn-ghost focus-ring text-[12px]"
        >
          {copied === 'bibtex' ? 'Copied' : 'Copy BibTeX'}
        </button>
        <button
          type="button"
          onClick={() => copy(url, 'url')}
          className="btn-ghost focus-ring text-[12px]"
        >
          {copied === 'url' ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}
