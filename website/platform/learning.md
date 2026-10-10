# Course & certification

The learning platform is a fifteen-lesson course in two tracks, thirty circuit challenges, six guided learning paths, a glossary, two proctored-style certification exams and a spaced-review system. All of it is built on the same principle as the simulator: the content is data, the rendering is derived from it, and anything that must be protected is protected on the server.

## The course

| Track | Lessons | Access |
| --- | --- | --- |
| Quantum Foundations | 8 | Free, served in full to everyone including crawlers |
| Advanced | 7 | `course.advanced` feature (Pro and above) |

Lessons are typed data (`lib/lessons/types.ts`): a discriminated union of blocks (prose, callouts, code with captions, links to live simulations, key points, inline checks, quizzes) with metadata (level, minutes, prerequisites, objectives). `lib/lessons/index.ts` holds the text-free outline that the client needs for navigation; the bodies live in `lib/lessons/bodies/` behind `server-only` and are read by exactly one Server Component.

### The paywall, in two halves

The server half, `app/learn/[slug]/page.tsx`, renders `previewBlocks(lesson, false)` for **every** request. It cannot identify the caller, so it must not try: the HTML is identical for an anonymous visitor, a crawler and a subscriber's first paint. The first three blocks of a paid lesson are in the document; withheld blocks are never serialised into it.

The client half, `LessonShell`, fetches `GET /learn/[slug]/content` after mount. That handler verifies the session token, calls `requireFeature(featureForLesson(slug))` and returns the withheld blocks, or 402. Subscribers see the paywall replaced in place; nothing is remounted, so blocks already on screen keep their identity.

Two tests make this structural rather than conventional: `lib/lessons/bundle.test.ts` walks the client import graph and fails if a body module is reachable from any `'use client'` file (ADR-0006), and the lesson page builds its client props field by field rather than spreading the lesson, so a newly added field fails to compile until someone decides whether it is public.

### Question-first gating

An inline check can appear before a section; until the learner commits an answer the following blocks stay hidden. Gating is applied over the whole reading order (free head plus unlocked tail together) and then split back at the paywall seam, so a check just before the seam still gates across it.

### Progress

Progress is `localStorage` first and syncs to `user_progress` when signed in: the merge is the union of completed lessons plus the best quiz score per lesson, pushed with a 1.5 s debounce, failing soft to local. A course-completion certificate at `/learn/certificate` is deliberately described as a record of study rather than a credential; its identifier is an ornamental hash, not a key into anything.

## Challenges, paths and glossary

Thirty challenges in `lib/challenges/catalogue.ts` are graded by `lib/challenges/grade.ts`, the same grader the MCP `grade_challenge` tool and the agent benchmark use, against target distributions, target states or gate-count par. Six paths (Quantum Curious, Quantum Software Engineer, Physics Student, Hardware Researcher, Quantum Security, Quantum AI & Optimisation) sequence lessons, visualizations and challenges. The glossary has about 67 terms with their own pages, and the Android home-screen widget draws a daily tip from the same list. A spaced-review page schedules recall of completed material; a coach page renders a skill map and a next-up recommendation from local progress.

## Certification exams

| Exam | Questions | Pass mark | Time | Access |
| --- | --- | --- | --- | --- |
| Quantum Foundations Certification | 15 | 70 % | 25 min | Free |
| Advanced Quantum Computing Certification | 20 (draws on the harder Foundations pool too) | 75 % | 40 min | `certification` (Pro) |

The exam engine is split the same way as the course: `catalogue.ts` is client-safe metadata; `questions.ts` is server-only and throws if it is ever bundled for the client, with `boundary.test.ts` proving it is not. The flow is `POST attempt` (starts a timed paper with a fixed question set), `answers` (progressive flush so a refresh resumes the same paper), `submit` (graded **server-side only**: any client-supplied score, pass flag or user id is ignored; a late submission gets 409 but still returns the result), then `certificate`.

A passed exam mints a credential id with 50 bits of randomness and a checksum character (`QL-XXXXX-XXXXX-X`), only after a signed-in, server-graded pass. `/verify/[certificateId]` is a public, dynamic page that shows name, exam, date and number, and nothing else: no score, no attempts, no email. An Open-Badges-style assertion is served at `/api/certificates/[id]/badge`, a LinkedIn "add to profile" link is generated, the `exam_passed` webhook fires, and a congratulation email template exists for deployments with Resend.

Accessibility work on the exam runner is specific: the countdown is announced to screen readers at 30, 15, 10, 5, 2 and 1 minutes, and the question card's answer state is reachable by keyboard throughout.

## Classrooms

Team and University organisations get named classes, assignments (lessons, challenges and exams with due dates), a gradebook CSV export and a cohort progress view. Progress sharing is **opt-in per learner per organisation**: an instructor sees a snapshot only when the learner has written a consent row, and the API returns `snapshot: null` for anyone who has not. LMS grade passback was removed from the plan as unbuildable while progress is local-first, and the documentation says so rather than listing it as a feature.
