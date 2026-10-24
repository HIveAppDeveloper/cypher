# Cypher: PRD and Architecture

Oct 24, 2026 · @Aadit Fadia

Cypher lets anyone run a team of AI agents just by chatting. It is cheap because it runs on the AI subscriptions people already pay for. Our first feature finds great founders, reaches out and books meetings for investors.

## What Cypher is

- **One chat, many agents.** You type what you want in plain English. A main agent splits the work and hands each part to the AI model that is best at it.
- **Built for non-technical people.** The interface is modeled on Grokbot. No setup, no prompts to write, no code. You approve and get results.
- **Works with any website.** Cypher turns any website into a tool (an MCP) that the agents can use.

## Why it is cheaper

AI subscriptions are subsidized: a flat monthly plan gives far more usage than the same money buys at pay-per-token API prices. Cypher turns the subscriptions you already pay for into API keys, so every agent runs on those cheaper tokens.

## Where it runs

| Option | Setup | Price |
| --- | --- | --- |
| Cypher cloud | Nothing. It runs on our servers. | Pay per usage |
| Your own cloud | One button to connect your account | Much lower per-usage fee |

## How it works

Agents never hold keys and never act on their own. Every action goes through a gateway we control, and you approve anything that cannot be undone.

&#91;embedded content: system architecture · 4 layers\]

1. You type a goal in the chat.
2. The main agent breaks it into small tasks.
3. Each task goes to the best specialist agent, running on subsidized tokens.
4. You approve the results, and Cypher acts.

## First feature: find great founders

The hackathon demo shows Cypher doing a VC's sourcing work from start to finish.

1. **Find.** Give it your investment thesis. It returns a ranked list of founders with reasons.
2. **Reach out.** It writes a personal message to each founder. You approve with one tap.
3. **Get meetings.** It reads replies, answers interested founders and books the call on your calendar.
4. **Get them interested.** It follows up on what each founder cares about until the meeting is set.

## Goals we will achieve

**At the hackathon**

- [ ] Live demo: thesis in, ranked founders out, in under 5 minutes
- [ ] Personal outreach drafted and approved in one tap
- [ ] A real reply handled and a meeting booked on stage
- [ ] Cost per task on subscriptions vs. API prices, measured and shown on screen

**After launch**

- [ ] Anyone gets a first result in under 15 minutes, with no setup
- [ ] At least 70% of drafts approved without edits
- [ ] One-button connection to your own cloud
- [ ] Zero security incidents

## Safety

- Each task runs in its own sandbox.
- Keys stay locked in our vault; agents never see them.
- Nothing is sent without your approval.
- Daily limits on sends and spending.
- A full log of everything the agents did.

## Risks

- **Provider rules.** Providers may limit using subscriptions this way. Backup: users plug in their own API keys.
- **Email rules.** Cold outreach must follow spam laws. Approvals, send limits and unsubscribe handling keep it compliant.
- **Copycats.** Routing is easy to copy. Our edge is ease of use and results.
