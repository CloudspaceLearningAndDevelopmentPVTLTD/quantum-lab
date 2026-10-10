import type { SchemaNode } from './schema'

/**
 * JsonLd — renders one <script type="application/ld+json"> block.
 *
 * Server component with no client cost: the JSON is serialized at render time
 * and the script tag is inert, so nothing here reaches the client bundle.
 *
 * THE ESCAPE IS NOT OPTIONAL. An HTML parser ends a <script> block at the first
 * literal `</script`, wherever it appears — including inside a JSON string. A
 * lesson subtitle or FAQ answer that ever contained `</` would otherwise break
 * out of the script and inject markup into the page. Replacing `<` with its
 * `<` escape is valid JSON (it parses back to the identical string) and is
 * the standard mitigation. Do not "simplify" it away.
 *
 * The payload is typed by the builders in ./schema.ts rather than by
 * `schema-dts`: that package is not a dependency here and package.json belongs
 * to another workstream. See docs/SEO.md for what that costs us.
 */
export function JsonLd({ data }: { data: SchemaNode | SchemaNode[] }) {
  // An empty array means the caller had nothing to describe — a 404'd lesson
  // slug, say. Emitting `[]` is valid JSON and completely meaningless markup;
  // emitting nothing is the honest result.
  if (Array.isArray(data) && data.length === 0) return null

  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return (
    <script
      type="application/ld+json"
      /*
       * The SECOND and last dangerouslySetInnerHTML in the app, after
       * components/ui/ThemeScript.tsx. Both are audited, and lib/security/
       * headers.ts leans on exactly that: its CSP ships
       * `script-src 'unsafe-inline'` and argues it is survivable because
       * everything else renders through React text nodes.
       *
       * Safe here for two reasons, and it needs both: the content is our own
       * serialized object graph and never user input, AND `<` is escaped to
       * < above, which is what stops a string inside that graph from
       * closing this <script> tag early and opening a real injection.
       */
      // eslint-disable-next-line react/no-danger -- see the note directly above.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}

export default JsonLd
