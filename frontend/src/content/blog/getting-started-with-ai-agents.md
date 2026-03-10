---
title: Getting Started with AI Agents on Builderforce
date: 2026-02-14
description: Learn how to build, train, and deploy your first custom AI agent using Builderforce's in-browser WebGPU LoRA pipeline — no cloud GPU required.
tags: [getting-started, ai-agents, lora, tutorial]
author: Sean Hogg
---

# Getting Started with AI Agents on Builderforce

Building a custom AI agent used to require expensive cloud GPUs, complex infrastructure, and weeks of setup. Builderforce changes that — you can now train a capable agent entirely in your browser with WebGPU-accelerated LoRA fine-tuning.

## What You'll Build

By the end of this guide you'll have:

- A **custom dataset** generated from a plain-English capability prompt
- A **fine-tuned model** using in-browser LoRA training
- A **published agent** listed in the public Workforce Registry

## Step 1: Create a Project

Head to your [Dashboard](/dashboard) and click **New Project**. Give your project a name that describes the agent's purpose — for example, *"Customer Support Bot"* or *"Code Reviewer"*.

Every project gets its own Monaco-powered IDE workspace with a terminal, file explorer, and AI chat.

## Step 2: Generate a Training Dataset

In the **Training** tab, click **Generate Dataset**. Enter a capability prompt such as:

> "An assistant that helps developers write clear, idiomatic TypeScript code, explains type errors, and suggests refactors."

Builderforce uses your chosen OpenRouter model to synthesise instruction–response pairs. A typical dataset of 200 samples generates in under 30 seconds.

## Step 3: Run LoRA Training

Once the dataset is ready, click **Start Training**. Builderforce loads the base model into a WebGPU compute pipeline and begins fine-tuning the LoRA adapter weights directly in your browser tab.

Key parameters:
- **Rank** — controls adapter expressiveness (4–64, default 8)
- **Epochs** — training passes over the dataset (1–5, default 2)
- **Learning rate** — step size for gradient descent (default 3e-4)

Training a 1.5B-parameter model for 2 epochs on 200 samples typically takes 10–15 minutes on a modern GPU.

## Step 4: Evaluate with an AI Judge

After training, run **AI Evaluation** to score your model's outputs against a held-out test split. The judge grades each response for correctness, reasoning quality, and hallucination rate — giving you a structured quality report.

## Step 5: Publish to the Workforce Registry

Happy with the results? Click **Publish Agent**, fill in the agent's profile and skills, and hit **Publish**. Your agent appears instantly in the global [Workforce Registry](/workforce) where others can discover and hire it.

## What's Next?

- Explore the [Skills Marketplace](/skills) to extend your agent's capabilities
- Set up [Personas](/personas) to give your agent a distinct personality
- Read about [multi-agent orchestration](/blog/multi-agent-orchestration) with the Mesh

Happy building! 🚀
