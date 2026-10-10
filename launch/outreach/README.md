# Outreach list

`targets.csv` is the mailing list. `../social/posts.md` is the social copy. The
seven email drafts themselves live in Gmail, unsent, with empty recipients.

## What the `email_status` column means

| Status | Meaning |
| --- | --- |
| `verified` | The address was found on a source page during research. Still worth a glance before sending — organisations move addresses. |
| `find` | The organisation is real and the contact page is in the row. The address is on that page; I did not open every one. |
| `form-only` | No public address. There is a contact form at `contact_url`. |
| `slack-only` / `forum-only` | No email channel. Introduce it in their community instead — a post lands better there than a mail would. |
| `per-institution` | A category, not a target. Expand it yourself; see below. |
| `do-not-email` | Reachable, but not by cold mail. See below. |

Three addresses are verified today: `info@quantumzeitgeist.com`,
`info@qworld.net`, `info@unitary.foundation`. That is a small number, and it is
small on purpose — every other row would have been a guess, and a guessed
address bounces, and bounces are what get a personal Gmail account rate-limited
or flagged.

## The two rows that are not really rows

**University quantum centres.** There is no list to download. What works is
picking 30-50 named centres and taking the contact off each site by hand — the
departmental office, the outreach or public-engagement lead, or the person who
teaches the intro quantum module, whose email is usually on the module page.
Worth prioritising: places that already run a public quantum course or a summer
school, because they have an audience and a reason to want more material. Budget
about two minutes per institution.

**Individual learners.** Do not try to email these. Any list you could buy is
scraped, emailing EU or UK individuals without prior consent is unlawful under
GDPR and PECR regardless of how good the product is, and the reputational damage
to a personal sending domain is not recoverable. This audience is exactly what
the GIFs in `../social/assets` are for — LinkedIn, X, r/QuantumComputing,
r/Physics, Discord servers, Hacker News. Draft 3 in Gmail is still useful: send
it to people who ask, and use it as the body of a landing-page welcome email.

## Sending, practically

- BCC, never To. Nobody should see anyone else's address.
- 30-50 a day from a personal Gmail, not one blast. Gmail's daily cap is around
  500 recipients, but volume is not the constraint — deliverability is. A sudden
  400-recipient BCC from an account that normally sends ten mails a day is the
  classic spam signal.
- Personalise the first line of each institutional mail. One sentence naming
  their course or their group changes the reply rate more than the rest of the
  email put together.
- Follow up once, after about two weeks, with draft 7. Then stop. Most replies
  come from the follow-up, and the second follow-up is what turns a non-reply
  into a complaint.
- Keep the opt-out line that is already in drafts 1, 2, 4 and 5. Honour it the
  first time.

## Highest-value first

If you only send ten emails this week, send them in this order:

1. Quantum Zeitgeist — they publicly invite pitches and take no payment.
2. QWorld — free-education non-profit, the closest thing to a mission match.
3. Unitary Foundation — the MIT licence and the from-scratch simulator are
   their kind of thing.
4. The Quantum Insider contact form — biggest reach on the list.
5-10. Six university centres that already run a public quantum course.

## Sources

- QWorld: <https://qworld.net/about-us/>
- Unitary Foundation: <https://unitary.foundation/>
- Quantum Open Source Foundation: <https://qosf.org/>
- Quantum Zeitgeist guest articles: <https://quantumzeitgeist.com/write-for-quantum-zeitgeist/>
- The Quantum Insider: <https://thequantuminsider.com/about/>
