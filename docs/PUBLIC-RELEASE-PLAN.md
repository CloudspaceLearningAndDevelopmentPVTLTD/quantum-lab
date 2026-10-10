# Qubit16 (qubit16.ai) — path to public release

Grounded in real competitive research and a 2026 technical-SEO checklist (sources
at the bottom), not general advice. This is a plan, not a finished job — see
"What's already done" vs "What's next" below.

## One decision needed before branding work starts

`qubit16.ai` as the domain raises the obvious question: does the **product
name** become "Qubit16" too, or does "Quantum Lab" stay the name while
qubit16.ai is just the URL it lives at (same pattern as, say, a product
called "Linear" living at linear.app)?

This isn't a small detail — `SITE.name` in `apps/web/lib/seo.ts` feeds every
page title, every Open Graph tag, the PWA manifest name, and the sitemap; a
rename touches dozens of files. Worth deciding once rather than guessing and
redoing. I've held off generating new brand assets until this is settled —
see "Branding" below for what already exists either way.

## What's already done (found during this pass, not new work)

- **A real logo/icon mark already exists**: `apps/web/app/icon.svg` — a
  dark-plate, two-orbital atom mark with a qubit-dot nucleus, deliberately
  built with a maskable PWA safe zone. It doesn't spell out a name (no
  wordmark), so it works as-is regardless of the naming decision above —
  it would need a companion wordmark only if you want text-plus-mark
  lockups (headers, share cards) rather than the icon alone.
- **SEO plumbing is already solid**: `apps/web/lib/seo.ts` centralizes
  metadata (title/description/canonical/OG), `app/robots.ts` and
  `app/sitemap.ts` exist, and `NEXT_PUBLIC_APP_URL` correctly drives
  canonical URLs (the empty-string build bug from this session's earlier
  Azure work is fixed). This is further along than most pre-launch products.
- **A genuine product differentiator exists** — see competitive landscape
  below — worth leading marketing copy with, not burying.

## What's next — prioritized

### 1. Domain wiring (qubit16.ai → the live Azure deployment)

Not done yet. `infra/azure/deploy.sh` deploys to Azure's own
`*.azurecontainerapps.io` subdomains by design (your own instruction:
"without domain" for the initial minimal deploy). Pointing `qubit16.ai` at
`quantum-lab-web`'s Container App needs, in order:
1. A DNS TXT record at your registrar for domain verification, then a CNAME
   (or apex ALIAS/ANAME, since `qubit16.ai` is a bare domain — most
   registrars call this "ALIAS" or "flattened CNAME") pointing at
   `quantum-lab-web`'s `*.azurecontainerapps.io` FQDN.
2. `az containerapp hostname add -n quantum-lab-web -g quantum-lab-rg
   --hostname qubit16.ai`, then a managed TLS certificate binding
   (`az containerapp hostname bind`) — Azure issues and renews this free
   automatically once DNS verifies.
3. Update `NEXT_PUBLIC_APP_URL=https://qubit16.ai` and rebuild `web` (same
   two-pass build pattern `deploy.sh` already uses) so canonical URLs, the
   sitemap, and OG tags stop pointing at the `azurecontainerapps.io` URL.
4. Point `api`/`agent`'s `ALLOWED_ORIGINS` at `https://qubit16.ai` alongside
   (or instead of) the Azure subdomain.

I can write this as a `infra/azure/attach-domain.sh` script once you confirm
where `qubit16.ai` is registered (Namecheap/GoDaddy/Cloudflare/etc. — the DNS
steps differ slightly) and have added the TXT/CNAME records, since domain
ownership verification can't be scripted from here — it requires action in
your registrar's dashboard.

#### attach-domain.sh is written

`infra/azure/attach-domain.sh` now exists and does steps 1-4 above in one
run. Verified in production: qubit16.ai is bound to `quantum-lab-web` with a
managed certificate, which is what the script does.

Run it after `deploy.sh` has already deployed `quantum-lab-web` successfully:

```
RESOURCE_GROUP=quantum-lab-rg ./infra/azure/attach-domain.sh
```

What to expect: it prints the exact TXT record (name + value, read live from
`quantum-lab-web`'s `customDomainVerificationId`) and the apex
ALIAS/ANAME/flattened-CNAME record you need to add at your registrar, then it
waits — retrying `az containerapp hostname add` every 30s for up to ~10
minutes — so add those two DNS records at your registrar while it's polling.
Once verification succeeds it binds the free managed TLS certificate,
rebuilds `web` with `NEXT_PUBLIC_APP_URL=https://qubit16.ai` baked in
(deploy.sh's own two-pass build pattern), and appends
`https://qubit16.ai` to `ALLOWED_ORIGINS` on `api`/`agent` alongside the
existing `azurecontainerapps.io` origin (additive, not a replacement). If DNS
isn't in place within the 10-minute window it times out with instructions —
add the records and just re-run the script, every step is check-then-act so
it picks up where it left off.

### 2. Technical SEO — concrete, prioritized checklist

From current best practice for SaaS sites in 2026 (SEOmator's audit
framework — see Sources):

**Critical**
- Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1 — "only 48% of mobile
  sites pass all three," so this is a real differentiator, not box-ticking.
  Not yet measured against the live Azure deployment — first thing to run
  once `qubit16.ai` is live (Lighthouse / PageSpeed Insights).
- Full-site crawl for broken links, redirect chains, orphaned pages — cheap
  to run (Screaming Frog or similar) once the domain is live.

**High priority**
- Self-referencing canonical tags on every page, one URL format enforced
  (`apps/web/lib/seo.ts` already does canonicals correctly per-page — verify
  post-domain-switch that they all resolve to `qubit16.ai`, not the Azure
  subdomain).
- Mobile tap-target sizing (48×48px minimum) — worth a pass once the shadcn
  UI migration (already in progress this session) reaches each route.

**Medium priority**
- Structured data: `SoftwareApplication`, `FAQPage`, `Organization`,
  `BreadcrumbList` schema. `Organization`/`WebSite` (`siteSchema()`) and
  `FAQPage` (the pricing page) already existed; `SoftwareApplication`
  (`softwareApplicationSchema()` in `components/seo/schema.ts`, wired into
  the home page) was added this pass — no `aggregateRating`/review count,
  since there's no real review data to report honestly.
- Title tags under 60 chars, meta descriptions under 155 — spot-check each
  route's `pageMetadata()` call against this once content is finalized.

**2026-specific: AI-search visibility**
- Allow AI crawlers in `robots.ts` — already covered: the existing
  `userAgent: '*'` wildcard allows every crawler, AI ones included, so no
  crawler-specific rule was needed (adding one would only risk narrowing
  it). Publish an `llms.txt` — done (`apps/web/public/llms.txt`), a short
  honest summary of the site and its real routes for AI answer engines to
  quote directly. Still open: a direct 40-60 word answer under each major
  heading on content pages (not yet audited page by page).

### 3. Competitive landscape — where Qubit16 actually stands out

Real platforms people compare against, from current research (see Sources):

| Competitor | What they offer | What they're missing |
| --- | --- | --- |
| IBM Quantum / Qiskit textbook | Free, real hardware access, huge community | No guided tutoring, steep for beginners, notebook-based not browser-native |
| Brilliant.org | Best-in-class interactive visual learning, no coding | No real circuit simulation or code — purely conceptual |
| edX/Coursera university courses (MIT, Berkeley, Tokyo, UChicago) | Academic rigor, real credentials | Multi-week commitment, lecture-format, not self-paced/interactive |
| Microsoft Quantum 101 / Azure Quantum | Free, Q#-focused, Microsoft ecosystem | Vendor-locked to Q#/Azure, not visualization-first |
| Udacity Quantum Nanodegree | Career-focused, mentorship | $399/month — expensive, long commitment |

**The gap Qubit16 already sits in**: nobody in this list combines
Brilliant's interactive/visual approachability with Qiskit's real circuit
execution AND a live AI tutor that explains what's on screen, in a browser
with zero install. That combination — visual + real + tutored + zero-install
— is the actual positioning, and it should be the first thing a visitor
reads, not implied.

**Concrete content gap this surfaces**: done — `/compare` now states the
differentiator plainly against every competitor in the table above, and
`/about` covers the "what is this and why" side. Both use `pageMetadata()`
and a breadcrumb schema, so they're indexable and citable the same way the
rest of the site is.

### 4. Content: About page — done

`/about` exists: honest, product-grounded content (mission, what's
actually different, how it's built) — no invented founder bios, dates,
funding or user-count claims, per this doc's own standard for not
overclaiming. Linked from the footer on every page and in `sitemap.ts`.

### 5. Branding: logo, favicon, wordmark — done

- **Favicon**: confirmed working — `apps/web/app/icon.svg` generates
  Next.js's icon route automatically. Along the way, fixed a latent bug in
  that file (and its `public/icons/` duplicate): a hyphen-underline inside
  an XML comment is invalid XML, harmless to browsers' lenient SVG parsing
  but broke strict tooling like `rsvg-convert`.
- **Wordmark**: `apps/web/public/brand/wordmark-{dark,light}.svg` — the
  existing icon mark plus "Qubit16" set in type, for places a bare icon
  doesn't read as a brand (OG/share images, header lockups, email
  templates). Built as SVG at the exact palette the icon already uses, not
  through an image-generation model.

## What I'd suggest doing first

Given everything above is real work, not a single afternoon: the highest
leverage first move is (1) settle the naming question, (2) wire the domain
so there's a real `qubit16.ai` URL to point SEO tooling and Lighthouse at,
and (3) write the About + differentiator-positioning content — those three
unblock nearly everything else on this list and are independent of the
shadcn UI migration and Azure milestone work already in progress this
session.

## Sources

- [Technical SEO Guide for SaaS: 8-Step Audit Checklist (2026) — SEOmator](https://seomator.com/blog/technical-seo-for-saas)
- [Top 16 Online Courses to Learn Quantum Computing — QuantumJobs](https://www.quantumjobs.us/post/what-are-best-online-courses-to-learn-quantum-computing)
- [Best Quantum Computing Courses Online 2026 — Quantum Navigator](https://entangledfuture.com/learn/quantum-computing-courses-online/)
- [Guide to the Top 10 Quantum Computing Software of 2026 — The CTO Club](https://thectoclub.com/tools/best-quantum-computing-software/)
