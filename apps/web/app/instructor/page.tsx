import InstructorTabs from '@/components/instructor/InstructorTabs'

// Metadata lives in ./layout.tsx, which also marks this route noIndex — see the
// comment there for why an authoring tool that emits unreviewed model output
// should not be in a search index. That reasoning still holds now that the page
// also carries cohort coursework: this is a staff surface, not a public one.
//
// NOT AN ACCESS CONTROL. `noIndex` keeps the page out of search results; it does
// not keep anyone out of the page. Every capability behind it — reading a
// cohort, publishing an assignment, exporting the gradebook — is gated
// server-side in app/api/orgs/** through lib/orgs/access.ts, against the
// caller's membership row for the org they named. Someone who opens this URL
// with no seat sees an empty console and gets a 403 from every call it makes.

export default function InstructorPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header>
        <span className="section-label">Instructor</span>
        <h1 className="section-title mt-2">Teaching</h1>
        <p className="section-desc mt-3">
          This page is for the people running the course, not taking it. Set work for a cohort and
          see who has done it, or draft course material with the co-pilot.
        </p>
      </header>

      <div className="mt-10">
        <InstructorTabs />
      </div>
    </div>
  )
}
