type MemberRow = {
  userId: string
  employeeId: string | null
  email: string
  displayName: string
  department: string
  available: boolean
  role: 'manager' | 'member'
}

export function MemberDirectoryTable({ members, ownerUserId, employees, showAvailability }: {
  members: MemberRow[]
  ownerUserId: string
  employees: Array<{ id: string; displayName: string }>
  showAvailability: boolean
}) {
  const employeeNames = new Map(employees.map(employee => [employee.id, employee.displayName]))
  return <div className="overflow-x-auto rounded-xl border border-border">
    <table className="w-full min-w-2xl text-left text-sm">
      <caption className="sr-only">All workspace members</caption>
      <thead className="bg-sunk-1 text-muted-foreground"><tr>
        <th scope="col" className="px-4 py-3 font-semibold">Member</th>
        <th scope="col" className="px-4 py-3 font-semibold">Account email</th>
        <th scope="col" className="px-4 py-3 font-semibold">Role</th>
        <th scope="col" className="px-4 py-3 font-semibold">Department</th>
        <th scope="col" className="px-4 py-3 font-semibold">Employee link</th>
        {showAvailability && <th scope="col" className="px-4 py-3 font-semibold">Browser handoff</th>}
      </tr></thead>
      <tbody className="divide-y divide-border">
        {members.map(member => <tr key={member.userId}>
          <th scope="row" className="px-4 py-3 font-medium text-foreground">{member.displayName || 'Name not set'}</th>
          <td className="break-all px-4 py-3">{member.email || 'Private'}</td>
          <td className="px-4 py-3 capitalize">{member.userId === ownerUserId ? 'Owner' : member.role}</td>
          <td className="px-4 py-3">{member.department || '—'}</td>
          <td className="px-4 py-3">{member.employeeId ? employeeNames.get(member.employeeId) || 'Linked' : 'Not linked'}</td>
          {showAvailability && <td className="px-4 py-3">{member.available ? 'Available' : 'Unavailable'}</td>}
        </tr>)}
      </tbody>
    </table>
  </div>
}
