import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { DEFAULT_BUSINESS_HOURS } from '@receptionist/shared'
import { WeeklyHours } from './WeeklyHours'
import { hoursErrors, replaceDay } from './weekly-hours'
import { employeeFormPatch } from './employee-form'
it('preserves exceptions and every interval in edited employee payloads', () => {
  const hours = { ...structuredClone(DEFAULT_BUSINESS_HOURS), exceptions: [{ date: '2026-12-25', intervals: [] }] }
  const edited = replaceDay(hours, 'mon', [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }])
  expect(edited.exceptions).toEqual(hours.exceptions)
  expect(employeeFormPatch(new FormData(), edited).workingHours).toEqual(edited)
  expect(hoursErrors(edited)).toEqual({})
})
it('rejects reversed and overlapping intervals with day errors', () => {
  for (const intervals of [[{ start: '12:00', end: '11:00' }], [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }]]) expect(hoursErrors(replaceDay(DEFAULT_BUSINESS_HOURS, 'mon', intervals)).mon).toBeTruthy()
})
it('labels days and each interval accessibly', () => {
  const html = renderToStaticMarkup(<WeeklyHours value={DEFAULT_BUSINESS_HOURS} onChange={() => {}} />)
  for (const label of ['Monday open', 'Monday interval 1 start', 'Monday interval 1 end', 'Add Monday interval', 'Remove Monday interval 1']) expect(html).toContain(label)
})
