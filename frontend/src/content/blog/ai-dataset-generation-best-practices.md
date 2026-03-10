---
title: AI Dataset Generation Best Practices
date: 2026-03-05
description: Tips and techniques for generating high-quality instruction-tuning datasets with Builderforce — from writing effective capability prompts to filtering noise.
tags: [dataset, fine-tuning, best-practices, quality]
author: Sean Hogg
---

# AI Dataset Generation Best Practices

The quality of your fine-tuned agent depends almost entirely on the quality of its training data. Garbage in, garbage out — but with a few deliberate practices, you can generate datasets that make a real difference.

## Start with a Sharp Capability Prompt

The capability prompt is the seed for your entire dataset. Vague prompts produce generic datasets; specific prompts produce targeted, useful ones.

**Weak prompt:**
> "A helpful coding assistant."

**Strong prompt:**
> "A TypeScript assistant that specialises in refactoring legacy JavaScript to modern TypeScript. It identifies implicit `any` types, adds explicit annotations, converts CommonJS `require` to ESM `import`, and explains every change with a one-sentence rationale."

The difference in the resulting dataset — and the resulting agent — is dramatic.

## Aim for Diversity

A good dataset covers the *full distribution* of inputs your agent will encounter in production. Use Builderforce's **diversity settings** to increase variation across:

- **Input complexity** — mix simple, medium, and complex examples
- **Edge cases** — include malformed inputs, ambiguous requests, and tricky edge cases
- **Tone and format** — vary the writing style of questions and answers

A dataset with 500 diverse examples typically outperforms one with 2 000 near-duplicate examples.

## Use the Right Model for Generation

Builderforce lets you pick any OpenRouter model for dataset generation. General guidance:

| Use case | Recommended models |
|----------|-------------------|
| Code-focused datasets | Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro |
| Reasoning datasets | o1, Claude 3 Opus |
| General instruction tuning | Llama 3.1 70B, Mistral Large |
| Budget-conscious generation | Gemini Flash, Llama 3.1 8B |

For specialised domains (medical, legal, finance), pair a powerful base model with domain-specific examples in your capability prompt.

## Review a Sample Before Training

Don't train on auto-generated data without reviewing it first. Builderforce shows you a random sample of 20 examples before you commit to training. Look for:

- ✅ Clear, unambiguous instructions
- ✅ Accurate, detailed responses
- ✅ Consistent formatting
- ❌ Hallucinated facts or code that doesn't compile
- ❌ Responses that are too short or off-topic
- ❌ Duplicates or near-duplicates

If more than 10–15% of the sample looks off, regenerate with a refined prompt.

## Layer Datasets for Complex Agents

For agents that need multiple capabilities, generate **separate datasets per capability** and merge them before training. This gives you control over the mixture:

```
dataset_a: 300 examples for TypeScript refactoring
dataset_b: 200 examples for code explanation
dataset_c: 100 examples for error diagnosis
─────────────────────────────────────────────────
merged:    600 examples, 50% / 33% / 17% split
```

A 50/33/17 split biases the agent towards its primary task while keeping secondary capabilities sharp.

## Use AI Evaluation to Close the Loop

After training, run **AI Evaluation** against a held-out test split (Builderforce reserves 20% of the dataset automatically). The evaluation report shows:

- **Correctness score** — does the output answer the instruction?
- **Reasoning score** — is the logic sound?
- **Hallucination rate** — does the output contain invented facts?

If scores are below target, look at which *categories* of examples scored lowest — those are the capabilities that need more training data.

## Iterate Quickly

The best datasets are built iteratively. A good workflow:

1. Generate 200 examples → train → evaluate
2. Identify weak areas from the evaluation report
3. Generate 100 targeted examples for weak areas
4. Merge datasets → retrain → evaluate again
5. Repeat until scores meet your bar

Each iteration takes about 15–20 minutes end-to-end with Builderforce's in-browser pipeline.

## Export and Version Your Datasets

Always export your final dataset as a JSONL file before training. This gives you:

- A reproducible training artefact
- The ability to re-train on a different base model later
- A starting point for future iterations

Name your exports semantically: `typescript-refactor-v1.jsonl`, `typescript-refactor-v2-more-edge-cases.jsonl`, and so on.

Happy dataset building! If you have questions or want to share your best prompts, post them in the [community forum](https://github.com/SeanHogg/Builderforce.ai/discussions). 🎯
