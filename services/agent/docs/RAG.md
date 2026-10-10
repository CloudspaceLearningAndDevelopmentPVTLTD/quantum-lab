# Course retrieval (RAG)

The tutor can quote and cite the actual course. `agent/rag/` indexes every lesson
the web app ships — roughly 20,000 words of prose, callouts, code listings, key
points and quiz explanations — and returns excerpts with the lesson title and
link attached.

Before this existed, `search_concepts()` scored keywords against 18 hand-written
concept blurbs. Those blurbs are still here and still used (see *Fallback*), but
they are not the course, and a tutor that cannot cite its own lessons is a tutor
that sends learners somewhere else.

## Why TF-IDF and not Pinecone

The design doc asked for a vector database behind an embedding model. What
shipped instead is TF-IDF with cosine similarity, for one overriding reason:
**this project must work offline with no API key.** That constraint rules out a
hosted embedding endpoint, and a local sentence-transformer would mean a
multi-hundred-megabyte model download on first use.

What TF-IDF buys:

| | TF-IDF (here) | Hosted embeddings + vector DB |
| --- | --- | --- |
| API key | none | required |
| Network at query time | none | every query |
| Model download | none | 100 MB–2 GB, or a hosted call |
| Determinism | byte-identical output for identical input | depends on model/service version |
| Reviewability | index is JSON — a diff shows exactly which terms and chunks moved | opaque float blobs |
| Infrastructure | a committed file | a service to run, fund and back up |
| Latency | sub-millisecond over ~150 chunks, pure Python | a network round trip |

**The honest trade-off:** TF-IDF matches vocabulary, not meaning. A light stemmer
and word bigrams close much of the gap — "why do measurements of two qubits
always match" retrieves the Entanglement lesson even though it shares no word
with that title — but a true paraphrase with *no* shared vocabulary will be
missed. A query for "spooky action at a distance" finds nothing unless the course
happens to use that phrase. Embeddings would catch it. That is the price paid for
working with no key on an aeroplane, and for this corpus size it is the right
trade.

Two more deliberate choices:

* **JSON, not pickle.** Pickle across Python or scikit-learn versions is a
  footgun, and an unreviewable binary in a pull request is worse than a large
  diff.
* **The index is a build artifact, committed to the repo.** Importing
  `agent.knowledge` or `agent.rag.retrieve` never rebuilds anything — a fresh
  checkout retrieves immediately, and CI does not need scikit-learn to run the
  agent, only to rebuild the index.

## Rebuilding the index

Two steps, because the content lives in TypeScript and the index is built in
Python.

```bash
# 1. Export the lesson data from TypeScript to JSON (repo root).
node scripts/export-lessons.mjs
#    -> services/agent/data/lessons.json

# 2. Chunk, vectorize and persist (from services/agent/).
.venv/bin/python -m agent.rag.index
#    -> services/agent/data/course_index.json
```

Run both after editing anything under `apps/web/lib/lessons/`, and commit both
JSON files. The export script uses the TypeScript compiler already vendored in
`node_modules/typescript` to transpile the lesson modules and then imports the
real exported objects, so it reads the actual data rather than guessing at it
with regexes. (The one exception is the `VISUALIZATIONS` array in `Hero.tsx`,
which is text-parsed because importing a React component would drag in
`next/link`; that is flagged in the script's header.)

`python -m agent.rag.index --help` exposes `--lessons`, `--out`,
`--target-words` and `--overlap-words`.

## Chunking parameters

`chunk_text(text, target_words=180, overlap_words=40)`.

* **180 words.** A whole lesson is too coarse to be a retrieval unit: it matches
  almost every query weakly and cites nothing specific. A single sentence is too
  fine to read as an excerpt. Roughly a paragraph and a half is long enough to
  stand alone in the model's context and short enough that a match means
  something.
* **40 words of overlap (~22%).** A chunk boundary is an arbitrary cut through
  continuous prose. Without overlap, an idea explained across the seam is
  represented weakly in both neighbours and wins nothing. Repeating the tail of
  each chunk at the head of the next means every sentence sits in a chunk that
  also carries its immediate context. The cost is a little duplicated text.
* **Paragraph-first packing.** Paragraphs are packed up to the target and only a
  paragraph that alone exceeds it is split further — and then only at sentence
  boundaries. Chunks never begin or end mid-sentence.
* **`embed` blocks are skipped.** They are links with a one-line blurb, not
  teaching content.
* **`code` blocks are kept whole.** Half a circuit listing retrieves badly and
  reads worse.
* **The lesson title is prepended to the indexed copy of every chunk** (not to
  the stored text a learner sees). A chunk deep inside the entanglement lesson
  rarely repeats the word "entanglement"; without the title, a query naming the
  topic ranks incidental matches elsewhere above the lesson that teaches it.

Vectorizer settings: `sublinear_tf=True` (a term appearing eight times is not
eight times as relevant), `stop_words='english'`, `ngram_range=(1, 2)` (bigrams
capture "bell state", "phase kickback", "error correction"), `min_df=1` (the
corpus is small; a term appearing once may be exactly the rare term that matters).
A conservative stemmer runs in the shared preprocessor so that
"entangled"/"entanglement" and "measure"/"measurement"/"measurements" match. The
stop-word list is persisted inside the artifact so query-time analysis cannot
drift from build-time analysis.

## Fallback

`knowledge.search_concepts(query, top_k=3)` keeps its exact signature and return
shape (`id`, `title`, `keywords`, `summary`) and now:

1. searches the course index, and returns the best excerpt per lesson if any
   scores at least `COURSE_MIN_SCORE` (0.10);
2. otherwise falls back to the original keyword scorer over `CONCEPTS`.

`knowledge.search_source()` returns `'rag'` or `'keyword'` for the most recent
call. The floor is stricter than the retriever's own default (0.05) on purpose: a
weak course match is worse than the curated blurb it would displace, and the
course genuinely does not cover everything the tutor is asked about — quantum
teleportation and decoherence, for example, have no lesson of their own and are
answered from `CONCEPTS`.
This also means the tutor still works on a checkout where the index has never
been built.

## Upgrade path to embeddings

`Index.search(query, top_k) -> list[(score, chunk)]` is the only query-time
interface, and cosine similarity over normalized vectors is the only operation.
Swapping in embeddings therefore means:

1. Write a second builder that embeds each chunk (any provider, or a local
   model) and writes dense vectors into the same JSON envelope, bumping
   `INDEX_VERSION`.
2. Give `Index` an `embed_query` that calls the same embedder instead of the
   TF-IDF analyzer. `search()` itself does not change — it is already just a dot
   product.
3. Leave `agent/rag/retrieve.py` and `agent/knowledge.py` untouched.

Keep TF-IDF as the offline default and select the embedding index only when a key
is configured, so the no-key path never regresses. A hybrid — take the union of
both rankings — is the usual next step, since lexical and semantic retrieval fail
on different queries.

## Tests

`tests/test_rag.py` builds a small index from an in-file fixture (never from the
committed artifact, so the suite is hermetic) and checks chunking, index
round-tripping, paraphrase retrieval, gibberish rejection and the keyword
fallback. No network, no API key.

```bash
cd services/agent && .venv/bin/python -m pytest tests/ -q
```
