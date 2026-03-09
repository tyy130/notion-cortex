# AI Agency Launch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Launch a live AI services agency capable of taking its first paying client within 7 days.

**Architecture:** Three standalone demos (voice agent, chatbot, automation) deployed to Vercel serve as the portfolio. An agency landing page ties them together. Upwork is the acquisition channel. Stripe handles recurring billing. Claude builds everything; Tyler creates accounts and deploys.

**Tech Stack:** Next.js 14, Vercel, Claude API, Vapi (voice), n8n cloud (automations), Stripe, GitHub

---

## Division of Labor

**Claude does:** All code, all copy, all configuration, all step-by-step instructions.
**Tyler does:** Creates accounts, pastes in what Claude writes, hits submit/deploy, handles identity verification.

Whenever a step says **[TYLER]**, Tyler performs it. Everything else is Claude.

---

## Task 1: Vapi Account + Voice Demo

**Goal:** A real phone number someone can call and hear an AI receptionist for a fictional HVAC company.

**Files:**
- Create: `demos/voice-receptionist/vapi-config.json`
- Create: `demos/voice-receptionist/README.md`

**Step 1: Create Vapi account**

**[TYLER]** Go to https://vapi.ai → sign up with Google or email → verify email → land on dashboard.

**Step 2: Get Vapi API key**

**[TYLER]** In Vapi dashboard → Settings → API Keys → copy the private key → paste it here in chat so Claude can use it to configure the assistant.

**Step 3: Claude creates the assistant config**

Claude writes `demos/voice-receptionist/vapi-config.json`:

```json
{
  "name": "Arctic Air HVAC Receptionist",
  "model": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "systemPrompt": "You are Sarah, the friendly receptionist for Arctic Air HVAC. You answer calls professionally, help customers schedule service appointments, answer questions about heating and cooling services, and collect contact information for callbacks. Arctic Air serves residential and commercial customers. Services include AC repair, furnace installation, heat pump service, and duct cleaning. Hours are Monday-Friday 7am-6pm, Saturday 8am-2pm. Always be warm, professional, and helpful. If someone needs emergency service, let them know we offer 24/7 emergency response at a $150 emergency fee."
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "rachel"
  },
  "firstMessage": "Thanks for calling Arctic Air HVAC, this is Sarah speaking. How can I help you today?",
  "endCallMessage": "Thank you for calling Arctic Air! We'll see you soon. Have a great day!",
  "endCallPhrases": ["goodbye", "bye", "that's all", "thanks bye"]
}
```

**Step 4: Create the assistant via Vapi API**

Claude runs (with Tyler's API key inserted):
```bash
curl -X POST https://api.vapi.ai/assistant \
  -H "Authorization: Bearer <TYLER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @demos/voice-receptionist/vapi-config.json
```

Save the returned `id` — this is the assistant ID.

**Step 5: Buy a phone number in Vapi**

**[TYLER]** In Vapi dashboard → Phone Numbers → Buy Number → choose any US number → assign the assistant created in Step 4.

**Step 6: Verify the demo works**

**[TYLER]** Call the Vapi phone number. Verify Sarah answers and handles a conversation about scheduling an AC repair.

Expected: natural conversation, handles questions, stays in character.

**Step 7: Write the demo README**

Claude writes `demos/voice-receptionist/README.md` with the phone number, what the demo does, and how to use it as a portfolio piece.

**Step 8: Commit**

```bash
git add demos/voice-receptionist/
git commit -m "feat: add voice receptionist demo (Arctic Air HVAC)"
```

---

## Task 2: AI Chatbot Demo

**Goal:** A live embeddable chatbot for a fictional real estate agent, deployed at a real URL, that can be shown to prospects.

**Files:**
- Create: `demos/chatbot/` (Next.js app)
- Deploy to Vercel at `chatbot-demo-[username].vercel.app`

**Step 1: Scaffold the Next.js app**

```bash
cd demos
npx create-next-app@latest chatbot --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd chatbot
```

**Step 2: Install dependencies**

```bash
npm install @anthropic-ai/sdk
```

**Step 3: Create the API route**

Create `demos/chatbot/app/api/chat/route.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Maya, the AI assistant for Jessica Torres, a real estate agent specializing in residential properties in Austin, Texas.

You help website visitors by:
- Answering questions about buying or selling homes in Austin
- Explaining the home buying/selling process
- Providing general info about Austin neighborhoods (South Congress, Mueller, Zilker, East Austin, Domain area)
- Collecting contact information from interested buyers/sellers
- Scheduling consultation calls with Jessica

Jessica's details:
- 12 years experience in Austin real estate
- Specializes in first-time buyers and move-up buyers
- Average list-to-close: 28 days
- 2023: sold 47 homes, avg sale price $612,000
- Phone: (512) 555-0142 | Email: jessica@torresthomes.com

Keep responses concise and warm. Always end by offering to connect them with Jessica directly.`;

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages,
  });

  return NextResponse.json({
    content: response.content[0].type === "text" ? response.content[0].text : "",
  });
}
```

**Step 4: Create the chat UI**

Replace `demos/chatbot/app/page.tsx`:

```tsx
"use client";
import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatDemo() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm Maya, Jessica's AI assistant. Looking to buy or sell a home in Austin? I'm here to help!" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next }),
    });
    const data = await res.json();
    setMessages([...next, { role: "assistant", content: data.content }]);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-slate-800 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-slate-800 font-bold text-sm">M</div>
          <div>
            <div className="text-white text-sm font-semibold">Maya</div>
            <div className="text-slate-400 text-xs">AI Assistant · Torres Homes</div>
          </div>
          <div className="ml-auto w-2 h-2 rounded-full bg-green-400"></div>
        </div>

        <div className="h-96 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-xs px-3 py-2 rounded-xl text-sm ${
                m.role === "user"
                  ? "bg-slate-800 text-white rounded-br-none"
                  : "bg-slate-100 text-slate-800 rounded-bl-none"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-100 px-3 py-2 rounded-xl rounded-bl-none text-slate-400 text-sm">
                typing...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t p-3 flex gap-2">
          <input
            className="flex-1 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Ask about Austin real estate..."
          />
          <button
            onClick={send}
            disabled={loading}
            className="bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 5: Add environment variable**

Create `demos/chatbot/.env.local`:
```
ANTHROPIC_API_KEY=your_key_here
```

**[TYLER]** Get your Anthropic API key from console.anthropic.com → paste it into `.env.local`.

**Step 6: Test locally**

```bash
cd demos/chatbot
npm run dev
```

Open http://localhost:3000 — send a few messages, verify Maya responds correctly about Austin real estate.

Expected: coherent, on-brand responses. Stays in character.

**Step 7: Deploy to Vercel**

```bash
cd demos/chatbot
npx vercel --prod
```

**[TYLER]** When prompted, link to your Vercel account. Add `ANTHROPIC_API_KEY` as environment variable in Vercel dashboard → Settings → Environment Variables.

**Step 8: Verify live URL works**

Open the Vercel URL — send a test message. Confirm it works identically to local.

**Step 9: Commit**

```bash
git add demos/chatbot/
git commit -m "feat: add AI chatbot demo (Torres Homes real estate)"
```

---

## Task 3: n8n Automation Demo

**Goal:** A live n8n workflow that demonstrates automated lead follow-up — when a form is submitted, it sends a personalized AI-written follow-up email. Screenshot + live demo URL for portfolio.

**Step 1: Create n8n cloud account**

**[TYLER]** Go to https://n8n.io → Start for free → sign up → verify email → you'll get a URL like `https://[your-name].app.n8n.cloud`.

**Step 2: Claude writes the workflow JSON**

Claude provides a complete n8n workflow JSON for: "New Lead → AI writes personalized email → Send via Gmail."

The workflow:
1. **Webhook trigger** — receives form submission with name, email, interest
2. **Claude API node** — writes a personalized follow-up email based on their interest
3. **Gmail node** — sends the email (or mock-sends for demo)

Claude will write this JSON after Step 1 so the n8n URL is known.

**Step 3: Import workflow into n8n**

**[TYLER]** In n8n → New Workflow → Import from JSON → paste Claude's JSON → Save.

**Step 4: Test the workflow**

**[TYLER]** In n8n → open workflow → click "Test Workflow" → send a test webhook payload.

Expected: workflow runs, Claude node generates email text, final node shows success.

**Step 5: Take portfolio screenshot**

**[TYLER]** Screenshot the completed workflow with all nodes visible. Save as `demos/automation/workflow-screenshot.png`.

**Step 6: Commit**

```bash
git add demos/automation/
git commit -m "feat: add automation demo (lead follow-up workflow)"
```

---

## Task 4: Agency Landing Page

**Goal:** A polished, live agency page presenting all three services with pricing, deployed to Vercel on a custom domain.

**Files:**
- Create: `agency-site/` (Next.js app)
- Deploy to Vercel

**Step 1: Scaffold the app**

```bash
npx create-next-app@latest agency-site --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd agency-site
```

**Step 2: Claude builds the full landing page**

Claude writes the complete `app/page.tsx` with:
- Hero: bold headline + subheadline + CTA button
- Three service cards with pricing
- How it works (3-step process)
- Social proof section (placeholder for future testimonials)
- Contact/booking CTA (links to Upwork or email)

Claude will write this in full at execution time.

**Step 3: Test locally**

```bash
npm run dev
```

Open http://localhost:3000 — verify all sections render, pricing is correct, no broken layouts on mobile.

**Step 4: Deploy**

```bash
npx vercel --prod
```

**Step 5: Connect custom domain (optional at launch)**

**[TYLER]** If you have a domain to use: in Vercel dashboard → your project → Settings → Domains → add your domain → follow DNS instructions.

**Step 6: Commit**

```bash
git add agency-site/
git commit -m "feat: add agency landing page"
```

---

## Task 5: Stripe Payment Setup

**Goal:** Three Stripe payment links (one per service) ready to send to clients. Recurring subscriptions configured.

**Step 1: Create Stripe account**

**[TYLER]** Go to https://stripe.com → Create account → verify email → complete basic business info (can use your name as business name to start).

**Step 2: Create products**

**[TYLER]** In Stripe dashboard → Products → Add product:

Product 1:
- Name: Voice AI Receptionist
- Pricing: Recurring, $99/month

Product 2:
- Name: AI Chatbot
- Pricing: $99 one-time + $49/month recurring (create two prices)

Product 3:
- Name: AI Workflow Automation
- Pricing: One-time, $199

Product 4:
- Name: Full AI Bundle
- Pricing: $149 one-time + $149/month recurring

**Step 3: Get payment links**

**[TYLER]** For each product → Payment Links → Create link → copy URL → paste the four links here in chat so Claude can embed them in the landing page and Upwork profile.

**Step 4: Update landing page with real payment links**

Claude updates `agency-site/app/page.tsx` CTA buttons with the actual Stripe payment links.

**Step 5: Redeploy**

```bash
cd agency-site && npx vercel --prod
```

---

## Task 6: Upwork Profile

**Goal:** A complete, live Upwork profile ready to bid on jobs.

**Step 1: Create Upwork account**

**[TYLER]** Go to https://upwork.com → Sign Up as a freelancer → complete identity verification (takes 1-2 days sometimes — start this early).

**Step 2: Claude writes all profile copy**

Claude will write:
- Professional headline (120 chars)
- Full bio/overview (5,000 char max — Claude fills it completely)
- Skills list (relevant tags)
- Hourly rate ($35/hr to start — competitive for getting first reviews)
- Portfolio entry titles and descriptions for each demo

**[TYLER]** Paste each section into the corresponding field in Upwork profile editor.

**Step 3: Upload portfolio items**

**[TYLER]** In Upwork → Profile → Portfolio → Add Work:
- "Voice AI Receptionist — Arctic Air Demo" → screenshot + description Claude writes + link to Vapi demo number
- "AI Chatbot — Torres Homes Demo" → screenshot + Vercel live URL + description
- "AI Lead Automation — n8n Workflow" → screenshot + description

**Step 4: Set availability**

**[TYLER]** Set availability to "More than 30 hrs/week" and enable "Open to offers."

**Step 5: Verify profile**

Profile should show: photo, headline, bio, 3 portfolio items, skills, hourly rate.

**Step 6: Note profile URL**

**[TYLER]** Copy your Upwork profile URL and paste here — Claude will use it for outreach copy later.

---

## Task 7: First Proposals

**Goal:** 10 proposals submitted to relevant Upwork jobs within 48 hours of profile going live.

**Step 1: Find relevant jobs**

**[TYLER]** In Upwork → Find Work → search each of these terms, note job links:
- "AI chatbot"
- "voice AI"
- "n8n automation"
- "AI assistant website"
- "chatbot for business"

Copy the 10 most recently posted with budgets over $100.

**Step 2: Claude reviews and selects**

Paste the job links here — Claude evaluates each one, selects the best 10 based on budget, requirements fit, and competition level.

**Step 3: Claude writes proposals**

For each selected job, Claude writes a complete proposal:
- Personalized opening referencing their specific need
- Brief relevant experience statement
- Demo link directly relevant to their use case
- Clear deliverable and timeline
- Call to action

Each proposal is ~150-200 words. Not templated — each one tailored.

**Step 4: Submit**

**[TYLER]** In Upwork → paste each proposal into the job application → submit.

**Step 5: Track responses**

**[TYLER]** When a client responds, copy the message and paste here — Claude writes the reply.

---

## Task 8: First Client Delivery

**Goal:** When first client is confirmed, deliver their service within the promised timeframe.

**Voice Receptionist delivery:**
1. Claude writes the custom Vapi assistant config for their business
2. Claude provides exact API call to create it
3. Tyler creates it, assigns to their number (or a new Vapi number)
4. Claude writes the handoff documentation
5. Tyler sends to client

**Chatbot delivery:**
1. Claude writes a new Next.js chatbot app configured for their business
2. Tyler deploys to Vercel
3. Claude writes the embed snippet (one `<script>` tag)
4. Tyler sends snippet + instructions to client

**Automation delivery:**
1. Claude writes the complete n8n workflow JSON for their specific use case
2. Tyler imports it into client's n8n (or a shared account Tyler manages)
3. Claude writes setup documentation
4. Tyler sends to client

---

## Success Checkpoints

- [ ] Voice demo: phone number rings, AI responds in character
- [ ] Chatbot demo: live URL, AI responds correctly
- [ ] Automation demo: workflow runs in n8n, screenshot captured
- [ ] Landing page: live on Vercel, pricing correct, CTAs work
- [ ] Stripe: 4 payment links functional
- [ ] Upwork: profile live, portfolio items uploaded
- [ ] Proposals: 10 submitted within 48 hours of profile live
- [ ] First response: handled within 2 hours (Claude writes reply)

---

## Timeline

| Day | Goal |
|-----|------|
| 1 | Tasks 1–3: All three demos live |
| 2 | Tasks 4–5: Landing page + Stripe live |
| 3 | Task 6: Upwork profile live |
| 4–5 | Task 7: 10 proposals submitted |
| 7–14 | Task 8: First client signed |
