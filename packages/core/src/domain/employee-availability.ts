import type { BusinessHours } from "@receptionist/shared";
import { intervalsForDate, localDateIso, zonedWallClockToUtc } from "./scheduling.js";

export type EmployeeEligibilityInput = {
  id: string; displayName: string; routingEnabled: boolean;
  manualAvailability: "available" | "unavailable" | "unknown";
  timezone: string; workingHours: BusinessHours;
};

// Provider state must describe this employee at the supplied instant; missing evidence is unknown.
export function employeeEligibility(employee: EmployeeEligibilityInput, now: Date, providerState?: "free" | "busy" | "unknown") {
  const date = localDateIso(now, employee.timezone);
  const open = intervalsForDate(employee.workingHours, date).some(interval =>
    now >= zonedWallClockToUtc(date, interval.start, employee.timezone) && now < zonedWallClockToUtc(date, interval.end, employee.timezone));
  const reason = !employee.routingEnabled ? "routing_disabled"
    : employee.manualAvailability === "unavailable" ? "manual_unavailable"
    : employee.manualAvailability !== "available" ? "manual_unknown"
    : !open ? "outside_hours"
    : providerState === "busy" ? "provider_busy"
    : providerState !== "free" ? "provider_unknown" : "available";
  return { id: employee.id, name: employee.displayName, available: reason === "available", reason };
}

export function employeeIntervalEligibility(employee: EmployeeEligibilityInput, start: Date, end: Date) {
  const initial = employeeEligibility(employee, start, 'free');
  if (!initial.available) return initial;
  let covered = start.getTime();
  const date = localDateIso(start, employee.timezone);
  const intervals = intervalsForDate(employee.workingHours, date).map(interval => ({
    start: zonedWallClockToUtc(date, interval.start, employee.timezone).getTime(),
    end: zonedWallClockToUtc(date, interval.end, employee.timezone).getTime(),
  })).sort((a, b) => a.start - b.start);
  for (const interval of intervals) if (interval.start <= covered && interval.end > covered) covered = interval.end;
  return covered >= end.getTime() && end > start ? initial : { ...initial, available: false, reason: 'outside_hours' };
}
