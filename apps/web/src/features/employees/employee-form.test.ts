import { describe, expect, it } from 'vitest'
import { employeeFormPatch } from './employee-form'
describe('employee private destination editing', () => {
  it('preserves an existing number when the private field is untouched', () => {
    const form = new FormData(); form.set('displayName', 'Sam'); form.set('department', 'Sales'); form.set('timezone', 'UTC'); form.set('manualAvailability', 'unknown'); form.set('transferNumber', '')
    expect(employeeFormPatch(form)).toEqual({ displayName: 'Sam', department: 'Sales', timezone: 'UTC', manualAvailability: 'unknown', routingEnabled: false })
  })
  it('supports explicit replacement and removal without using the mask as a value', () => {
    const form = new FormData(); form.set('transferNumber', '+14155550123')
    expect(employeeFormPatch(form).transferNumber).toBe('+14155550123')
    form.set('removeTransfer', 'on')
    expect(employeeFormPatch(form).transferNumber).toBeNull()
  })
})
