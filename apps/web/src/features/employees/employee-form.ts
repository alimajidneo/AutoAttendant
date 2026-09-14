import type { EmployeeDraft, BusinessHours } from '@receptionist/shared'
export function employeeFormPatch(form: FormData, workingHours?: BusinessHours): EmployeeDraft {
  const number = String(form.get('transferNumber') ?? '').trim()
  return {
    ...(workingHours ? { workingHours } : {}),
    displayName: String(form.get('displayName') ?? '').trim(),
    department: String(form.get('department') ?? '').trim() || null,
    timezone: String(form.get('timezone') ?? ''),
    manualAvailability: String(form.get('manualAvailability') ?? 'unknown') as EmployeeDraft['manualAvailability'],
    routingEnabled: form.get('routingEnabled') === 'on',
    ...(form.get('removeTransfer') === 'on' ? { transferNumber: null } : number ? { transferNumber: number } : {}),
  }
}
