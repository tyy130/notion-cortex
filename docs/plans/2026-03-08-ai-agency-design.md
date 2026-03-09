# AI Agency — Design Document
**Date:** 2026-03-08
**Goal:** Generate fast, steady recurring income by selling AI services to small businesses.

---

## The Business

A lean AI services agency offering three productized services to small businesses. No custom scoping, no negotiation — fixed packages with clear deliverables and fast turnaround. Tyler is the face and hands; Claude drives strategy, builds all deliverables, and writes all copy.

---

## Service Menu

| Service | Setup | Monthly | Delivery |
|---|---|---|---|
| Voice AI Receptionist | $0 | $99/month | 48–72 hrs |
| AI Chatbot | $99 | $49/month | 48–72 hrs |
| AI Workflow Automation | $199 flat | — | 3–5 days |
| Full Bundle | $149 | $149/month | 5–7 days |

### Service Descriptions

**Voice AI Receptionist**
An AI that answers the business's phone calls 24/7, handles FAQs, books appointments, and captures leads. Built on Vapi. Connects to their existing phone number or a new one. Target customers: HVAC, dental, legal, medical, home services.

**AI Chatbot**
A conversational widget embedded on their website, trained on their business info. Handles support questions, captures leads, routes inquiries. Built with Claude API, deployed as a lightweight embeddable script.

**AI Workflow Automation**
One targeted automation that eliminates a specific manual task — lead follow-up sequences, invoice processing, CRM syncing, social scheduling. Built on n8n cloud + AI integrations.

**Full Bundle**
All three services. Positions as a complete "AI business stack." Highest value, highest retention.

---

## Pricing Philosophy

Prices are intentionally low for launch. The goal is 5 paying clients with testimonials, not maximum revenue per client. Once testimonials exist, prices increase. At 10 bundle clients: $1,490 MRR with no additional work.

---

## Client Acquisition

### Priority 1: Upwork
- Primary channel at launch
- Claude writes full profile, all proposals, all client communications
- Tyler pastes and submits
- Fastest path to first client — inbound demand already exists

### Priority 2: Agency Landing Page
- Claude builds it, Tyler deploys to Vercel with a custom domain
- Provides credibility when clients Google after seeing Upwork profile
- Goes live before or alongside Upwork profile

### Priority 3: Local Business Outreach
- Activated after first 1–2 testimonials
- Claude writes outreach scripts (email, Facebook DM, Instagram DM)
- Tyler sends them

---

## Tech Stack

| Purpose | Tool |
|---|---|
| Voice agents | Vapi |
| Chatbots | Claude API + custom widget |
| Automations | n8n cloud |
| Hosting | Vercel + GitHub |
| Payments | Stripe (recurring billing links) |
| Domain | Tyler's existing setup |

---

## Division of Labor

**Claude does:**
- Builds all demos (one per service, deployed to Vercel)
- Writes complete Upwork profile
- Writes every proposal word-for-word
- Drafts every client communication
- Builds every client deliverable
- Provides step-by-step instructions for every action Tyler takes

**Tyler does:**
- Creates accounts (Upwork, Vapi, Stripe, n8n) following Claude's instructions
- Pastes and submits what Claude writes
- Deploys when Claude says deploy
- Handles anything requiring his identity (verification, payments, banking)
- Serves as the human face when clients need one

---

## Launch Sequence

1. Claude builds 3 demo deployments (one per service)
2. Claude writes full Upwork profile copy
3. Tyler creates Upwork account and populates it
4. Tyler creates Stripe account (for payments)
5. Start bidding on day one
6. Claude builds agency landing page (parallel)
7. Tyler points domain at Vercel deployment

---

## Success Criteria

- **Week 1:** Upwork profile live, all demos deployed, bidding started
- **Week 2–3:** First paying client
- **Month 1:** 3+ paying clients
- **Month 3:** 10+ clients, $1,000+ MRR, prices increase

---

## Upgrade Path

Clients enter at the lowest friction point (usually chatbot or automation), see results, then get offered the next service. Bundle is the natural end state. Each service stacks recurring revenue without replacing the previous one.
