---
name: research
description: For web research, information gathering, summarization.
version: 1.0.0
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

Use this skill when the user asks for information that requires web searching or looking up external knowledge.

## Instructions
1. Identify the core query and formulate effective search terms.
2. Use `search_web` to find relevant sources.
3. Read multiple sources if needed using `read_url_content` to cross-verify facts.
4. Synthesize the findings into a clear, concise summary.
5. Provide citations or links to the sources used.

## Safety Guidelines
- Do not trust unverified sources for critical information.
- Avoid passing PII or sensitive data in search queries.

## Examples
- User: "research the latest developments in quantum computing"
  Agent: uses `search_web` with query "latest quantum computing developments", reads articles, and summarizes findings.
- User: "who is the CEO of OpenAI?"
  Agent: uses `search_web` to quickly look up current leadership.
