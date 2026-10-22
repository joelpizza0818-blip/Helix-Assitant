---
name: research
description: Investigate external or unfamiliar topics using targeted authoritative sources, cross-checking, dates, citations, and explicit uncertainty.
version: 2.0.0
triggers:
  - research
  - search
  - find
  - look up
  - investigate
  - summarize
  - what is
  - who is
tools:
  - search_web
  - read_url_content
permissions:
  - network
dependencies: []
---

# Research Skill

Use when the answer requires current, niche, or externally verifiable information. Convert the request into specific questions, time scope, geography, and decision criteria.

## Procedure

1. Search authoritative primary sources first: official docs, laws, papers, datasets, filings, or direct statements.
2. Use secondary sources for context and compare material claims across independent sources.
3. Check publication date, event date, version, authorship, methodology, and conflicts of interest.
4. Map each material claim to a source; never rely on search snippets alone.
5. Synthesize only supported conclusions and label inference, disagreement, outdated material, and missing evidence.
6. Provide direct links or citations near supported claims.

## Safety

Do not send secrets or unnecessary PII in searches. For medical, legal, financial, security, or current-policy topics, verify authoritative current sources and state limitations. Never invent citations.

## Examples

- User: "What changed in this API?"
  Agent: compares official versioned release notes and documentation and cites each material change.
- User: "Investigate this company."
  Agent: separates confirmed facts, reported claims, and inference with dates and source quality.
