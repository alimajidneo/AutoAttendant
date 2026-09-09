import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { KnowledgeItem } from '@receptionist/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageContainer } from '@/layout/PageContainer'
import { PageHeader } from '@/layout/PageHeader'
import { keys, fetchers } from '@/lib/queries'
import { apiClient } from '@/lib/apiClient'
import { useAgentZone } from '@/hooks/useAgentZone'
import { formatDate } from '@/lib/formatters'

export default function KnowledgePage() {
  const qc = useQueryClient()
  const zone = useAgentZone()
  const [search, setSearch] = useState('')
  const [pendingDelete, setPendingDelete] = useState<KnowledgeItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  const { data, isLoading } = useQuery({ queryKey: keys.knowledge, queryFn: fetchers.knowledge })

  const del = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/knowledge/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.knowledge })
      toast.success('Answer deleted')
    },
    onError: () => toast.error('Could not delete that answer. Try again.'),
  })

  const add = useMutation({
    mutationFn: () => apiClient.post('/admin/knowledge', { question, answer }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.knowledge })
      setQuestion('')
      setAnswer('')
      setAdding(false)
      toast.success('FAQ added')
    },
    onError: () => toast.error('Could not add that FAQ. Try again.'),
  })

  const items = useMemo(() => {
    const all = data ?? []
    const term = search.trim().toLowerCase()
    if (!term) return all
    return all.filter(
      (i) =>
        i.question.toLowerCase().includes(term) || i.answer.toLowerCase().includes(term),
    )
  }, [data, search])

  return (
    <PageContainer className="flex flex-1 flex-col">
      <PageHeader
        title="Knowledge"
        description="FAQs and answers your agent can use during calls."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add FAQ
          </Button>
        }
      />

      {!isLoading && (data?.length ?? 0) > 0 && (
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="relative w-field-lg">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search answers"
              aria-label="Search answers"
              className="w-full pl-8"
            />
          </div>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {data?.length} {data?.length === 1 ? 'answer' : 'answers'}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <p className="py-2 text-muted-foreground">
          Nothing in the knowledge base yet. Add an FAQ, or answer a caller question in
          Escalations to save it here.
        </p>
      ) : items.length === 0 ? (
        <p className="py-2 text-muted-foreground">Nothing matches that.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_96px_28px] gap-3 px-2.5 pb-1.5 text-muted-foreground">
            <span>Question and answer</span>
            <span className="text-right">Added</span>
            <span />
          </div>
          <ul className="flex flex-col">
            {items.map((item) => (
              <li
                key={item.id}
                className="group grid grid-cols-[minmax(0,1fr)_96px_28px] items-start gap-3 rounded-lg border-t border-border px-2.5 py-3 hover:bg-hover"
              >
                <div className="min-w-0">
                  <p className="leading-snug font-medium text-foreground">{item.question}</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">{item.answer}</p>
                </div>
                <span className="text-right text-muted-foreground tabular-nums">
                  {formatDate(item.createdAt, zone)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPendingDelete(item)}
                  disabled={del.isPending}
                  aria-label={`Delete the answer to ${item.question}`}
                  className="-mt-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="Delete this answer?"
        description="Your agent stops using it, and the next caller who asks is passed to you. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!pendingDelete) return
          await del.mutateAsync(pendingDelete.id)
        }}
      />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an FAQ</DialogTitle>
            <DialogDescription>
              Write the answer exactly as the receptionist should understand it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block" htmlFor="faq-question">
              <span className="mb-1.5 block font-semibold text-foreground">Question</span>
              <Input
                id="faq-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Do you offer parking?"
              />
            </label>
            <label className="block" htmlFor="faq-answer">
              <span className="mb-1.5 block font-semibold text-foreground">Answer</span>
              <Textarea
                id="faq-answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Yes, free parking is available behind the building."
                className="min-h-[7lh] resize-y"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              onClick={() => add.mutate()}
              disabled={!question.trim() || !answer.trim() || add.isPending}
            >
              {add.isPending ? 'Adding' : 'Add FAQ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
