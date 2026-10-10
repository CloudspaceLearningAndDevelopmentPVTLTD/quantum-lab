'use client'

import { useEffect, useId, useState } from 'react'

/**
 * The "run this yourself in Claude Code" block: the documented MCP endpoint
 * (docs/MCP.md) on THIS deployment, plus a prompt that drives the five
 * experiment tools end to end. The origin is read from the browser so a
 * self-hosted deployment shows its own URL, with the public one as the
 * server-render fallback.
 */

const FALLBACK_ORIGIN = 'https://qubit16.ai'

export function buildSnippet(origin: string): string {
  return [
    '# 1. Point Claude Code at this deployment’s MCP server (docs/MCP.md)',
    `claude mcp add --transport http quantum-lab ${origin}/api/mcp/mcp`,
    '',
    '# 2. Hand it an experiment and go to bed',
    'claude "Using the quantum-lab MCP tools: create_experiment titled',
    '  \'Bell pair under two-qubit noise\' with the hypothesis \'odd-parity counts',
    '  appear at about p2/2 when the CX gate is depolarised with probability p2\'.',
    '  Then run_step the Bell circuit (h q[0]; cx q[0], q[1];) with 4096 shots',
    '  and seed 1 on target simulator, then on noisy-simulator with',
    '  depolarizing2 = 0.02, 0.05 and 0.1 (depolarizing1 = 0, readoutError = 0),',
    '  writing a one-line note per step. Finish with conclude_experiment stating',
    '  whether the hypothesis held, citing the counts and the step numbers."',
    '',
    `# 3. Read the record in the morning: ${origin}/workbench/experiments`,
  ].join('\n')
}

export function ClaudeCodeSnippet() {
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const labelId = useId()

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
      setOrigin(window.location.origin)
    }
  }, [])

  useEffect(() => {
    if (copied === 'idle') return
    const t = window.setTimeout(() => setCopied('idle'), 2000)
    return () => window.clearTimeout(t)
  }, [copied])

  const snippet = buildSnippet(origin)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p id={labelId} className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          Run this yourself in Claude Code
        </p>
        <button type="button" onClick={copy} className="btn-ghost focus-ring text-xs" aria-describedby={labelId}>
          Copy
        </button>
      </div>
      <pre
        className="focus-ring overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-relaxed text-ink"
        tabIndex={0}
        aria-labelledby={labelId}
      >
        {snippet}
      </pre>
      <p className="mt-1 min-h-[1.25rem] text-xs text-ink-muted" role="status" aria-live="polite">
        {copied === 'done' ? 'Copied to the clipboard.' : copied === 'failed' ? 'Copy failed — select the text and copy it by hand.' : ''}
      </p>
    </div>
  )
}
