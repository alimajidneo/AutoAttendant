import { useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/useAuth'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Section, Row } from './SettingsList'
import { SaveBar } from './SaveBar'
import { userAvatarUrl } from '@/lib/user-profile'
import { ExternalLink } from 'lucide-react'

export function AccountPanel() {
  const { user } = useAuth()
  const email = user?.email ?? ''
  const avatarUrl = userAvatarUrl(user)

  const [firstName, setFirstName] = useState(user?.user_metadata.first_name ?? '')
  const [lastName, setLastName] = useState(user?.user_metadata.last_name ?? '')
  const [saving, setSaving] = useState(false)

  const changes = useMemo(() => {
    const out: string[] = []
    if (firstName !== (user?.user_metadata.first_name ?? '')) out.push('first name')
    if (lastName !== (user?.user_metadata.last_name ?? '')) out.push('last name')
    return out
  }, [firstName, lastName, user])

  async function saveProfile() {
    if (!supabase) return
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`.trim() } })
      if (error) throw error
      toast.success('Profile saved')
    } catch (err: unknown) {
      const message =
        (err as { errors?: { message?: string }[] })?.errors?.[0]?.message ||
        'Could not save your profile. Try again.'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Section title="Profile">
        <li className="flex items-center gap-3.5 p-4">
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              className="size-10 rounded-full border border-border object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {user?.user_metadata.first_name} {user?.user_metadata.last_name}
            </p>
            <p className="truncate text-muted-foreground">{email}</p>
          </div>
        </li>
        <Row
          title="First name"
          description="Shown here only. Your agent never says it."
          htmlFor="first-name"
        >
          <Input
            id="first-name"
            className="w-field-md"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </Row>
        <Row
          title="Last name"
          description="Shown here only. Your agent never says it."
          htmlFor="last-name"
        >
          <Input
            id="last-name"
            className="w-field-md"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </Row>
        <Row
          title="Email"
          description="You sign in with Google, so your email is managed there."
          htmlFor="email"
        >
          <Input id="email" className="w-field-lg" value={email} readOnly disabled />
        </Row>
      </Section>

      <Section title="About">
        <Row
          title="Source code"
          description="View the source code for this version of DeskRoute."
        >
          <a
            href="https://github.com/alimajidneo/AutoAttendant"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-semibold text-accent-ink hover:underline"
          >
            Open repository
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Row>
      </Section>

      <SaveBar
        changes={changes}
        saving={saving}
        onSave={saveProfile}
        onDiscard={() => {
          setFirstName(user?.user_metadata.first_name ?? '')
          setLastName(user?.user_metadata.last_name ?? '')
        }}
      />
    </div>
  )
}
