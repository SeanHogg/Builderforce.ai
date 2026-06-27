---
title: The AI Agent Tech Stack, Built — How Builderforce.ai Implements All Seven Layers
date: 2026-06-27
description: The seven-layer agent stack everyone diagrams — foundation model, orchestration, memory, RAG, tools, observability, deployment — is a shopping list of separate vendors. Builderforce.ai ships all seven as one integrated platform, and meets-or-exceeds the reference design at every layer.
tags: [agent-stack, rag, evaluation, memory, orchestration, architecture]
author: Sean Hogg
---

# The AI Agent Tech Stack, Built — How Builderforce.ai Implements All Seven Layers

Every "AI agent tech stack" explainer draws the same picture: seven layers, each a job, each a place the agent can break. The foundation model gets the headlines; the six layers beneath it decide whether the thing actually works in production.

The catch with the canonical version of that diagram is that it's a *shopping list*. Pick a model vendor. Bolt on LangGraph. Add a memory library. Stand up a vector database. Wire tools. Buy an observability SaaS. Containerise and deploy. Seven layers, seven vendors, seven failure modes, and a lot of glue code holding the seams together.

Builderforce.ai is the same seven layers — built as **one platform**. This post walks each layer, maps it to what Builderforce.ai actually runs, and is honest about the two layers we just hardened to go from "have it" to "exceed it."

![The seven-layer agent stack, implemented end-to-end by Builderforce.ai](/blog/agent-stack-seven-layers.svg)

## The scorecard

| # | Layer | The reference design | Builderforce.ai |
|---|-------|----------------------|-----------------|
| 1 | Foundation model | Pick one vendor | Multi-vendor gateway, 30+ providers, learned routing + fallback |
| 2 | Orchestration | LangGraph ReAct loop | Native ReAct loop + multi-agent orchestrator (roles, DAG, retries) |
| 3 | Memory | A library for working + episodic | All four memory types, SSM-native, write-through cognition |
| 4 | Vector DB & RAG | Pinecone/Chroma + embeddings | **Chunking + hybrid (dense+BM25) + rerank** over LanceDB or SSM store |
| 5 | Tools & integrations | `@tool` + MCP | Capability-gated registry, MCP server, browser, 10+ channels |
| 6 | Observability & eval | LangSmith/Langfuse | Tracing + cost metering **+ faithfulness/hallucination + drift** |
| 7 | Deployment | Docker + a queue | Cloudflare Workers + Durable Objects + Containers + Docker |

Five of these already exceeded the reference design. Two — RAG and evaluation — were *good but conventional-thin*. We closed both. Here's the tour.

## Layer 1 — Foundation model

The reference advice is "choose GPT-5.5 or Claude or Gemini." Builderforce.ai treats the model as a **swappable, routed resource** rather than a commitment. One OpenAI-compatible gateway fronts 30+ providers (OpenRouter, Cerebras, NVIDIA NIM, Cloudflare Workers AI, Ollama, Anthropic direct). It learns from run outcomes which model wins for a given action type and biases routing toward it, exhausts cheaper models before premium ones, and fails over on capacity errors — all behind a single endpoint with BYO keys and adjustable reasoning effort.

**Verdict: exceeds.** You don't bet the product on one vendor's roadmap.

## Layer 2 — Orchestration

A single ReAct loop (think → act → observe) is the floor. Builderforce.ai runs that loop natively, then puts a **multi-agent orchestrator** on top: specialist roles (creator, reviewer, test-generator, bug-analyzer, …), a task dependency graph, bounded retries with self-healing, and durable state that survives a process restart. The same loop runs on-prem and in the cloud, with a built-in adversarial review pass.

**Verdict: exceeds.** A coordinated team with governance beats one agent in a loop.

## Layer 3 — Memory

The reference stack usually delivers working + episodic memory from a framework. Builderforce.ai ships **all four** — working, episodic, semantic, procedural — and they're *SSM-native*: knowledge is written through into a model (Evermind) via online distillation rather than only appended to a store, with a persistent cross-session fact store underneath.

**Verdict: exceeds.** Memory that *learns*, not just memory that *logs*.

## Layer 4 — Vector DB & RAG  ✦ hardened this release

Here's where we were honest with ourselves. Builderforce.ai had vector retrieval (LanceDB + embeddings, plus a zero-API SSM embedding store) — but it was *cosine-only*. The textbook RAG stack does three things cosine-only retrieval doesn't: it **chunks** documents into precise passages, it runs **hybrid** search (dense vectors *and* sparse BM25, so exact tokens — identifiers, error codes, rare names — aren't lost), and it **reranks** for relevance and diversity.

So we built all three into the canonical memory layer:

![Hybrid retrieval: dense and sparse signals, fused by RRF and reranked by MMR](/blog/hybrid-retrieval.svg)

- **Chunking** — a recursive character splitter with overlap, so large documents become coherent passages.
- **BM25** — Okapi lexical scoring alongside the dense vector pass.
- **Reciprocal Rank Fusion** — merges the two rankings on *rank*, not on incomparable raw scores.
- **MMR reranking** — trades relevance against novelty so the top-k isn't five near-duplicates.

It degrades gracefully: no embedding model available → BM25-only; no lexical overlap → dense-only. It's wired into both the SSM memory store and the LanceDB long-term-memory path, with chunking applied on write.

**Verdict: now exceeds.** Hybrid + rerank is the part most hand-rolled RAG stacks never get to.

## Layer 5 — Tools & integrations

A tool is a typed function the model can choose to call. Builderforce.ai has a **capability-gated tool registry** (tools declare the capabilities they need; the runtime filters them per surface — cloud, container, on-prem — so the same tool set runs anywhere), an **MCP server** exposing tools to external IDEs, Playwright browser automation, web/search/git/shell tools, 10+ messaging channels, and a plugin SDK for custom tools.

**Verdict: exceeds.** One tool contract, every surface, no per-surface hand-curation.

## Layer 6 — Observability & evaluation  ✦ hardened this release

LLMs fail silently — a hallucinated answer still returns HTTP 200. Builderforce.ai already traced every LLM call, metered tokens and cost, and scored runs on *outcome* (did the PR merge, did CI pass, how many steps, how much spend). What it didn't do was score whether the answer was **grounded and on-topic** — the semantic-eval metrics every LLM-observability tool now ships.

We added them:

![Evaluation and drift: faithfulness, relevance, hallucination — plus regression alerts](/blog/evaluation-and-drift.svg)

- **Faithfulness** — is the answer supported by its context?
- **Answer / context relevance** — does it address the question; was the retrieved context relevant?
- **Hallucination rate** — the share of the answer *not* grounded.

Two backends, one interface: a **zero-cost lexical scorer** runs inline on every cloud run (no extra LLM call), and an **LLM-as-judge** upgrade is available on demand via `/api/eval`, billed through the same metered gateway as any other completion. Scores persist on the run record, and a **drift monitor** — mean-shift z-score plus Population Stability Index — compares a baseline window to a recent window per (action-type × model) and raises an alert when quality regresses. It runs daily on cron and on demand via `/api/eval/drift`.

**Verdict: now exceeds.** A silent quality regression becomes an alert, not a green dashboard.

## Layer 7 — Deployment

The reference design is Docker plus a sync API or async queue. Builderforce.ai runs on **Cloudflare Workers + Durable Objects** (a durable agent loop that ticks past serverless timeout walls) plus **Containers** for shell-bearing runs, with Docker for local dev. Caching is first-class — read-through (L1 in-isolate + L2 KV), prompt caching, and a semantic response cache — alongside per-tenant cost caps and step budgets.

**Verdict: exceeds.** Durable, cached, cost-capped, and managed.

## The point

Understanding the full stack doesn't mean assembling seven vendors and praying the seams hold. Builderforce.ai is the seven layers as a single, governed, observable system — and after this release it doesn't just *have* every layer, it **meets or exceeds** the reference design at each one. The two layers that were merely conventional — RAG retrieval and semantic evaluation — are now hybrid-and-reranked and faithfulness-scored-with-drift-detection respectively.

That's the difference between a stack you diagram and a stack you ship.

> Want the deep dive? See the [Evermind](/evermind) model behind the memory layer, or [start building for free](/register).
