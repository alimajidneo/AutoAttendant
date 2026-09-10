import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, AudioWaveform, BookOpen, CheckCircle2, Moon, Search, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTheme } from '@/hooks/useTheme'
import { guides } from './guides'

export default function HelpPage() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const { theme, setTheme } = useTheme()
  const selected = guides.find(guide => guide.id === params.get('guide')) ?? guides[0]
  const index = guides.indexOf(selected)
  const matches = guides.filter(guide => JSON.stringify(guide).toLowerCase().includes(search.trim().toLowerCase()))
  const next = guides[index + 1]
  const heading = useRef<HTMLHeadingElement>(null)
  const previousGuide = useRef(selected.id)

  useEffect(() => {
    if (previousGuide.current !== selected.id) {
      heading.current?.focus({ preventScroll: true })
      heading.current?.scrollIntoView({ block: 'start' })
      previousGuide.current = selected.id
    }
  }, [selected.id])

  function selectGuide(id: string) {
    setParams({ guide: id })
    setSearch('')
  }

  return (
    <div className="min-h-screen bg-stage text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-accent-ink"><AudioWaveform aria-hidden="true" />DeskRoute</Link>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link to="/workspaces" className="hover:text-accent-ink">Workspaces</Link>
            <Link to="/" className="hover:text-accent-ink">Open app</Link>
            <Button variant="ghost" size="icon" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-page px-5 py-8 md:py-10">
        <div className="mb-8 rounded-2xl border border-primary/20 bg-primary-subtle p-6 md:p-8">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-accent-ink"><BookOpen className="size-5" aria-hidden="true" />HELP & TUTORIAL</p>
          <h1 className="text-2xl font-bold tracking-tight">A good first call starts here.</h1>
          <p className="mt-3 max-w-narrow leading-relaxed text-muted-foreground">Set up your receptionist, connect calendars and help your team handle calls. Follow the guides in order, or find the step you need.</p>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-3">
          <aside className="rounded-2xl border border-border bg-card p-4 shadow-low">
            <label htmlFor="guide-search" className="mb-2 block text-sm font-semibold">Find a guide</label>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="guide-search" type="search" value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9" /></div>
            <nav aria-label="Tutorial topics" className="mt-4 grid gap-1">
              {matches.map(guide => <Link key={guide.id} to={`/help?guide=${guide.id}`} onClick={() => setSearch('')} aria-current={selected.id === guide.id ? 'page' : undefined} className={`rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${selected.id === guide.id ? 'bg-primary-subtle text-accent-ink' : 'hover:bg-sunk-1'}`}>{guide.title}</Link>)}
            </nav>
            {matches.length === 0 && <p role="status" className="mt-4 text-sm text-muted-foreground">No matching guides. Try “calendar”, “invite” or “microphone”.</p>}
            <p className="mt-5 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">Google calendars and browser calls are available. Microsoft, Slack and Teams integrations are planned.</p>
          </aside>
          <article aria-labelledby="guide-title" className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-low md:col-span-2 md:p-7">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="rounded-full bg-primary-subtle px-3 py-1 text-accent-ink">Guide {index + 1} of {guides.length}</span><span className="text-muted-foreground">{selected.audience}</span></div>
            <h2 ref={heading} tabIndex={-1} id="guide-title" className="mt-4 scroll-mt-6 text-xl font-bold">{selected.title}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{selected.summary}</p>
            <ol className="my-7 space-y-6">
              {selected.steps.map((step, stepIndex) => <li key={step.title} className="flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-sm font-bold text-accent-ink" aria-hidden="true">{stepIndex + 1}</span><div><h3 className="pt-1 font-bold">{step.title}</h3><p className="mt-2 leading-relaxed text-muted-foreground">{step.detail}</p></div></li>)}
            </ol>
            <div className="rounded-xl border border-border bg-primary-subtle p-4"><h3 className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-5 shrink-0 text-accent-ink" aria-hidden="true" />What you should see</h3><p className="mt-2 leading-relaxed">{selected.outcome}</p></div>
            <section className="mt-7" aria-label="Common questions"><h3 className="mb-3 font-bold">Good to know</h3>{selected.notes.map(note => <details key={note.title} className="border-t border-border py-3"><summary className="cursor-pointer font-semibold leading-relaxed">{note.title}</summary><p className="mt-3 leading-relaxed text-muted-foreground">{note.detail}</p></details>)}</section>
            <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-border pt-5">
              {index > 0 ? <Button variant="ghost" onClick={() => selectGuide(guides[index - 1].id)}><ArrowLeft />Previous guide</Button> : <Link to="/" className="self-center text-sm font-semibold text-accent-ink">Open DeskRoute</Link>}
              {next && <Button onClick={() => selectGuide(next.id)}>Next guide<ArrowRight /></Button>}
            </div>
          </article>
        </div>
      </main>
    </div>
  )
}
