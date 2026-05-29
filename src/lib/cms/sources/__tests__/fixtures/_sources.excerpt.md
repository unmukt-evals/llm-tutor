---
type: source-library
track: B
purpose: Canonical primary-source library for Track B (Training, Agents & Evals). Every Track B module teaches FROM these sources and cites them. Read the relevant entries before any Track B session — the differentiation comes from knowing the primary material, not a paraphrase of it.
verified: 2026-05-26 (fetched + distilled from the live pages; verbatim quotes are exact)
---

# Track B — Primary Source Library

These nine sources were recommended to Unmukt by colleagues and are the spine of Track B. The rule (see SKILL.md): **teach from the source, quote the source, link the source.** When a module's engineer-pass makes a claim, it should trace to a line below.

Two of the nine (RL-environments guide, Collinear post) are JS-gated and were recovered via browser render on 2026-05-26 — content is captured here so a session never has to re-fetch.

---

## Cluster 1 — RL post-training (how the model got its behavior)

### S2 · Why GRPO is important and how it works — Oxen.ai (Arxiv Dives)
- **URL:** https://ghost.oxen.ai/why-grpo-is-important-and-how-it-works/
- **What:** Practitioner walkthrough aimed at GPU-poor fine-tuners; the author trained a 1B Llama-3.2 into a reasoner on 16GB VRAM.
- **Thesis:** Dropping the value model roughly halves the compute of PPO/RLHF and puts reasoning-RL within reach of a single consumer GPU.
- **Mechanism that matters:** R1 pipeline alternates SFT and GRPO. `advantage = z-score over the group's rewards`. KL to the reference prevents **reward hacking**. R1-Zero goes further — **no neural reward model**, just regex/string-match rewards (accuracy + format), which reduces hacking but doesn't generalize past what's specified.
- **Quote (the reward-hacking image to keep):** *"If it finds out that saying the word 'pamplemousse' gets a high reward because it is a rarer word (and fun one to say) we don't want it latching onto this behavior…"*
- **Quote:** *"It means they are literally using regexes and string matching for reward signals. They argue that this helps with 'reward hacking' and simplifies the whole training pipeline."*
- **Grounds:** B2 (primary), B3 (reward hacking link).

---

## Cluster 2 — RL environments & reward design (the world the model trains/eval's in)

### S4 · Is your RL environment fair to your agent? — Adit Jain, Collinear AI
- **URL:** https://blog.collinear.ai/p/is-your-rl-environment-fair-to-your  *(JS-gated Substack; recovered 2026-05-26)*
- **What:** The single most directly-relevant post to what TrustEvals is. By Adit Jain (Collinear), 2026-05-14. Collinear = "The Simulation Lab for AI Teams" (Nazneen Rajani).
- **Thesis & definition to memorize:** *"an environment (or evaluation) is fair when score differences are driven mainly by the capability you intend to measure, and are mostly invariant to nuisance factors like contamination, verifier bugs, environment drift, and benign prompt paraphrases."* Eval and environment are the same thing in a modern multi-tool multi-step setup.
- **Mechanism that matters:**
  - **Fair to the agent** (not fair w.r.t. race/gender). A capability = a repeatable ability to produce a desired outcome under specified conditions. A fair eval measures *that* capability — not outcomes outside the specified conditions.
  - **Four ways an eval is unfair:** (1) **Prompt underspecification** (missing constraint → fail confounded with ambiguity; equally-valid solution paths should score equally); (2) **Environment issues** (stale package, dead tool, drifting filesystem → attribute the failure to the env, not the agent); (3) **Harness not environment-centric** (truncated stderr hides the bug; misspecified tool schema confuses; an unintended 10-step cap hamstrings planning); (4) **Asking it to do things it wouldn't do in production** (tasks it's told to refuse in prod, tools not on the deployed surface, personas it never adopts).
  - **Treat the verifier as a system under test:** measure its agreement with humans, its variance across paraphrases, its false-positive / false-negative rates. *"their errors compound at every step of hill-climbing."*
  - **Reward hacking is a fairness problem:** *"In RL, the verifier is the reward. Anything the verifier accepts is a valid policy."* *"Fair RL requires that the only cheap way to get reward is to do the task."* Shortcuts: lenient-format answers, tool calls that get reward without changing env state, rubric pattern-matching, outputting answer + its negation when the verifier checks substring presence.
  - **The fair-eval checklist (use verbatim):** Specification · Harness parity (eval harness matches deployment on tools/formats/limits) · Distribution match · Verifier audit (FP/FN vs humans) · Paraphrase invariance · **Failure attribution** (was it the agent, the harness, the environment, or the verifier?).
- **Quote:** *"Verifiers are rarely audited as carefully as the agents they grade but their errors compound at every step of hill-climbing. Treat the verifier as a system under test."*
- **Grounds:** B1 (fairness lens — primary), B3 (reward design — primary).

### S5 · Harbor — framework docs (Terminal-Bench team)
- **URL:** https://www.harborframework.com/docs  *(only the Motivation page was retrievable)*
- **What:** "A framework for evaluating and optimizing agents and models in container environments." Grew out of Terminal-Bench.
- **Mechanism that matters:** simple modular interfaces for **environments, agents, and tasks**; pre-integrated CLI agents; a registry of benchmarks/datasets; cloud-sandbox integrations (Daytona, Modal, E2B, Runloop, Tensorlake) for horizontal scaling; optimization integrations **SkyRL + GEPA**. The honest line: *"defining and managing containerized tasks at scale is hard."*
- **Grounds:** B1 (a real harness in the wild), B3 (container-env scaling).

---

## Cluster 5 — Mechanistic interpretability (looking inside the model)

### S9a · Scaling Monosemanticity — Anthropic / Transformer Circuits (Templeton, Conerly, et al.; Olah)
- **URL:** https://transformer-circuits.pub/2024/scaling-monosemanticity/index.html (May 2024)
- **What:** The paper that scaled sparse autoencoders to a production model (Claude 3 Sonnet) and extracted millions of interpretable features.
- **Mechanism that matters:**
  - Foundations: **linear representation hypothesis** (concepts = directions in activation space) + **superposition** (more features than dimensions, via almost-orthogonal directions) → **dictionary learning via SAEs**.
  - SAE = encoder (linear+ReLU → high-dim features) + decoder (reconstruct). Loss = L2 reconstruction + **L1 sparsity penalty**. Three SAEs: ~1M / ~4M / ~34M features; <300 active per token.
  - **Validation = specificity + influence.** Influence is demonstrated by **feature steering / "clamping"** a feature to artificially high/low values during the forward pass.
  - **Golden Gate feature (34M/31164353):** fires on the bridge across languages and on images; clamped to 10× max, the model self-identifies as the bridge.
  - **Feature splitting:** "San Francisco" → 1 feature (1M SAE) → 2 (4M) → 11 (34M). Distance in decoder space ≈ relatedness in concept space.
  - **Safety-relevant features** found and *causally steerable*: deception, sycophancy, bias, power-seeking, bioweapons, backdoors. The "test set for safety" hope.
- **Quote:** *"the linear representation hypothesis suggests that neural networks represent meaningful concepts – referred to as features – as directions in their activation spaces."*
- **Quote:** *"there's a difference (for example) between knowing about lies, being capable of lying, and actually lying in the real world."*
- **Quote:** *"One hope for interpretability is that it can be a kind of 'test set for safety', which allows us to tell whether models that appear safe during training will actually be safe in deployment."*
- **Grounds:** B7 (primary).
