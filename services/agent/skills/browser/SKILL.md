---
name: browser
description: For web browsing, page interaction, form filling, scraping.
version: 1.0.0
triggers:
  - browse
  - open website
  - navigate
  - click
  - fill form
  - scrape
  - download page
tools:
  - read_browser_page
  - click_element
  - type_text
  - navigate_browser
permissions:
  - network
  - browser_control
dependencies: []
---

# Browser Skill

Use this skill for interacting with web pages in a headless or visible browser environment.

## Instructions
1. Navigate to the requested URL using `navigate_browser`.
2. Inspect the page state using `read_browser_page`.
3. Interact with elements (clicking, typing) to achieve the goal (e.g., logging in, filling forms).
4. Extract requested information or confirm successful actions.

## Safety Guidelines
- Do not enter user passwords or sensitive info unless explicitly authorized.
- Be mindful of rate limits and terms of service when scraping.

## Examples
- User: "go to github.com and log in"
  Agent: navigates to GitHub, finds username/password fields, types credentials, and clicks login.
- User: "scrape the product prices from this URL"
  Agent: opens URL, reads the page structure, and extracts the prices.
