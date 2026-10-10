---
title: How Qubit16 is built
hide:
  - toc
---

<div class="q16-hero" markdown>

# How Qubit16 is built

**qubit16.ai** is an open-source platform for learning quantum computing by playing with it: a 16-qubit statevector simulator that runs in the browser, forty interactive visualizations, a fifteen-lesson course, an AI tutor, and a path to real quantum hardware. It is developed by **Cloudspace Learning and Development Private Limited** and released under the MIT licence.

This site is the engineering documentation: the architecture, the physics engine and how it is verified, the security model, the test and deployment pipeline, and the practices the codebase is held to. It is written for engineers who want to understand, run, extend or audit the system.

[Source on GitHub](https://github.com/CloudspaceLearningAndDevelopmentPVTLTD/quantum-lab){ .md-button .md-button--primary }
[Open qubit16.ai](https://qubit16.ai){ .md-button }

</div>

<div class="q16-stats" markdown>
<div class="q16-stat" markdown><strong>16</strong><span>qubits, exact, in the browser, free for everyone</span></div>
<div class="q16-stat" markdown><strong>10⁻⁹</strong><span>agreement with Qiskit required on every amplitude</span></div>
<div class="q16-stat" markdown><strong>100</strong><span>pages and 61 API route handlers in the web app</span></div>
<div class="q16-stat" markdown><strong>4,100+</strong><span>automated tests across three services</span></div>
<div class="q16-stat" markdown><strong>29</strong><span>database tables, every one with row-level security</span></div>
<div class="q16-stat" markdown><strong>0</strong><span>required environment variables to run the whole stack</span></div>
</div>

## What the system is

Three services and two store apps, with the browser doing most of the work:

```mermaid
flowchart LR
  subgraph Client
    B[Browser / PWA]
    IOS[iOS app<br/>WKWebView shell]
    AND[Android app<br/>Trusted Web Activity]
  end
  subgraph Web["apps/web — Next.js 16"]
    P[Pages, simulator,<br/>visualizations, course]
    R[61 route handlers<br/>auth · quota · proxy]
  end
  subgraph Services
    API["services/api — FastAPI<br/>Qiskit · Aer · PennyLane"]
    AG["services/agent — FastAPI<br/>LangChain tutor + RAG"]
  end
  subgraph Managed
    SB[(Supabase<br/>Postgres + Auth)]
    ST[Stripe]
    RS[Resend]
    QPU[IBM · Braket · Azure<br/>quantum hardware]
    LLM[Gemini · Groq ·<br/>Anthropic · Azure OpenAI]
  end
  IOS --> B
  AND --> B
  B --> P
  B --> R
  R --> SB
  R --> ST
  R --> RS
  R -- shared secret --> API
  R --> AG
  API --> QPU
  AG --> LLM
  R --> LLM
```

The simulator, every visualization, the circuit editor, the course and the offline tutor execute entirely in the browser. The server exists for accounts, metered quotas, real hardware and large language models, and every one of those is optional: the stack builds and runs with an empty environment and degrades visibly rather than failing.

## Where to start

<div class="q16-cards">
  <a class="q16-card" href="architecture/"><h3>Architecture</h3><p>The three services, request lifecycle, trust boundaries, data model and billing.</p></a>
  <a class="q16-card" href="simulator/"><h3>Simulator engine</h3><p>A zero-dependency statevector engine: gate set, OpenQASM 3, classical control, GPU backend.</p></a>
  <a class="q16-card" href="simulator/verification/"><h3>Verification</h3><p>How the engine is checked against Qiskit and PennyLane on random circuits up to 16 qubits.</p></a>
  <a class="q16-card" href="security/"><h3>Security</h3><p>Threat model, per-route authorisation, headers, rate limiting, secrets and store-app compliance.</p></a>
  <a class="q16-card" href="quality/"><h3>Quality &amp; testing</h3><p>Unit, end-to-end, accessibility and cross-check suites, and the CI gates that run them.</p></a>
  <a class="q16-card" href="operations/"><h3>Operations</h3><p>Containers, Azure Container Apps, continuous deployment, health, observability and email.</p></a>
</div>

## The stack at a glance

| Layer | Technology |
| --- | --- |
| Web application | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.6 strict, Tailwind CSS 3.4, Radix primitives, three.js |
| Physics engine | Hand-written TypeScript statevector simulator (zero runtime dependencies), optional WebGPU backend, stabilizer tableau |
| Accounts and data | Supabase (Postgres, Auth, row-level security), 29 tables, 15 idempotent migrations |
| Billing | Stripe Checkout, webhooks and customer portal; entitlements enforced server-side only |
| Hardware service | FastAPI, Qiskit + Aer, PennyLane Lightning; IBM Quantum, Amazon Braket, Azure Quantum SDKs |
| Tutor service | FastAPI, LangChain tool-calling agent, TF-IDF retrieval over the course, LiteLLM provider routing |
| Delivery | Docker (non-root, multi-stage), Azure Container Apps, Cloudflare, GitHub Actions with OIDC |
| Quality | Vitest, Playwright + axe-core, pytest, Qiskit/PennyLane cross-checks, bundle budgets, WCAG 2.2 AA audit |
