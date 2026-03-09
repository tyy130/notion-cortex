import { Bot, Phone, Zap, CheckCircle, ArrowRight, Star } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <nav className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">StackAI</span>
          </div>
          <a href="mailto:hello@stackai.agency" className="text-sm text-zinc-400 hover:text-white transition-colors">
            hello@stackai.agency
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 py-24 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 text-violet-400 text-sm mb-8">
            <Star size={12} />
            AI-powered tools for small businesses
          </div>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight mb-6 leading-tight">
            Your business,<br />
            <span className="text-violet-400">always on.</span>
          </h1>
          <p className="text-xl text-zinc-400 mb-10 max-w-xl mx-auto">
            We build AI voice agents, chatbots, and automations that work while you sleep. Setup in days, not months.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#services" className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2">
              See what we build <ArrowRight size={16} />
            </a>
            <a href="mailto:hello@stackai.agency" className="border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white font-semibold px-8 py-3.5 rounded-xl transition-colors">
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4">Three tools. One agency.</h2>
            <p className="text-zinc-400 text-lg">Pick what you need. Stack them for maximum impact.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-violet-500/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center mb-5">
                <Phone size={20} className="text-violet-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">Voice AI Receptionist</h3>
              <p className="text-zinc-400 text-sm mb-5">Answers your phones 24/7, books appointments, handles FAQs. Sounds like a real person.</p>
              <div className="mb-5">
                <div className="text-2xl font-black text-white">$99<span className="text-zinc-500 font-normal text-base">/mo</span></div>
                <div className="text-zinc-500 text-sm">Free setup</div>
              </div>
              <ul className="space-y-2 mb-6">
                {["Answers inbound calls", "Books appointments", "Custom voice & personality", "Works 24/7"].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                    <CheckCircle size={14} className="text-violet-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <a href="#contact" className="block text-center bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Get started
              </a>
            </div>

            <div className="bg-zinc-900 border border-violet-500/40 rounded-2xl p-6 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                Most popular
              </div>
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center mb-5">
                <Bot size={20} className="text-violet-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">AI Chatbot</h3>
              <p className="text-zinc-400 text-sm mb-5">A smart chat widget trained on your business. Captures leads and answers questions instantly.</p>
              <div className="mb-5">
                <div className="text-2xl font-black text-white">$49<span className="text-zinc-500 font-normal text-base">/mo</span></div>
                <div className="text-zinc-500 text-sm">$99 one-time setup</div>
              </div>
              <ul className="space-y-2 mb-6">
                {["Lives on your website", "Trained on your business", "Captures leads automatically", "Instant responses"].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                    <CheckCircle size={14} className="text-violet-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <a href="#contact" className="block text-center bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Get started
              </a>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-violet-500/40 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center mb-5">
                <Zap size={20} className="text-violet-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">AI Workflow Automation</h3>
              <p className="text-zinc-400 text-sm mb-5">Eliminate one manual task completely. Lead follow-up, CRM sync, invoicing — done automatically.</p>
              <div className="mb-5">
                <div className="text-2xl font-black text-white">$199<span className="text-zinc-500 font-normal text-base"> flat</span></div>
                <div className="text-zinc-500 text-sm">One-time, yours to keep</div>
              </div>
              <ul className="space-y-2 mb-6">
                {["Custom-built for your workflow", "Runs automatically", "No monthly fee", "Handoff documentation"].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                    <CheckCircle size={14} className="text-violet-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <a href="#contact" className="block text-center bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Get started
              </a>
            </div>
          </div>

          {/* Bundle */}
          <div className="mt-8 bg-gradient-to-r from-violet-900/40 to-zinc-900 border border-violet-500/30 rounded-2xl p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <div className="text-violet-400 text-sm font-semibold mb-1">Full AI Stack Bundle</div>
              <h3 className="text-2xl font-black mb-2">All three services. One monthly price.</h3>
              <p className="text-zinc-400">Voice agent + chatbot + automation — fully configured and running in under a week.</p>
            </div>
            <div className="text-center shrink-0">
              <div className="text-3xl font-black">$149<span className="text-zinc-400 font-normal text-lg">/mo</span></div>
              <div className="text-zinc-500 text-sm mb-3">$149 one-time setup</div>
              <a href="#contact" className="block bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-3 rounded-xl transition-colors whitespace-nowrap">
                Get the bundle
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-black tracking-tight mb-4">Live in 72 hours</h2>
          <p className="text-zinc-400 mb-12">No long onboarding. No technical setup on your end.</p>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { n: "01", title: "You tell us your needs", body: "Quick call or message. We learn your business in 15 minutes." },
              { n: "02", title: "We build it", body: "We configure everything — AI, integrations, branding. Zero work for you." },
              { n: "03", title: "You go live", body: "We hand it over, walk you through it, and you're up and running." },
            ].map(s => (
              <div key={s.n} className="text-left">
                <div className="text-4xl font-black text-zinc-800 mb-3">{s.n}</div>
                <h3 className="font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-zinc-400 text-sm">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-black tracking-tight mb-4">Ready to automate?</h2>
          <p className="text-zinc-400 mb-8">Send us a message and we&apos;ll get back to you within a few hours.</p>
          <a href="mailto:hello@stackai.agency" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-bold px-10 py-4 rounded-xl text-lg transition-colors">
            hello@stackai.agency <ArrowRight size={18} />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-zinc-500 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-violet-500 flex items-center justify-center">
              <Zap size={10} className="text-white" />
            </div>
            <span className="font-semibold text-zinc-400">StackAI</span>
          </div>
          <span>© 2026 StackAI. Built with AI, delivered fast.</span>
        </div>
      </footer>
    </main>
  );
}
