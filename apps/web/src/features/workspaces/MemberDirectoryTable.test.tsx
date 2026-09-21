import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MemberDirectoryTable } from './MemberDirectoryTable'

it('lists every member and preserves private account emails', () => {
  const html = renderToStaticMarkup(<MemberDirectoryTable ownerUserId="owner" showAvailability employees={[{ id: 'employee', displayName: 'Sam Employee' }]} members={[
    { userId: 'owner', employeeId: null, email: 'owner@example.test', displayName: 'Ali', department: 'Operations', available: true, role: 'manager' },
    { userId: 'member', employeeId: 'employee', email: '', displayName: 'Sam', department: 'Sales', available: false, role: 'member' },
  ]} />)
  for (const text of ['All workspace members', 'Ali', 'Owner', 'Sam', 'Sales', 'Sam Employee', 'Private', 'Unavailable']) expect(html).toContain(text)
  expect(html).not.toContain('member@example.test')
})
