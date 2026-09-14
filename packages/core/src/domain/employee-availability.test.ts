import { describe, it, expect } from "vitest";
import { employeeEligibility, type EmployeeEligibilityInput } from "./employee-availability.js";
import { DEFAULT_BUSINESS_HOURS } from "@receptionist/shared";
const employee = { id: "employee", displayName: "Sam", routingEnabled: true, manualAvailability: "available" as const,
  timezone: "America/New_York", workingHours: DEFAULT_BUSINESS_HOURS };
const now = new Date("2026-09-14T14:00:00Z");
describe("employee eligibility", () => {
  it.each([undefined, "unknown"] as const)("fails closed for provider state %s", state => {
    expect(employeeEligibility(employee, now, state)).toEqual({ id: "employee", name: "Sam", available: false, reason: "provider_unknown" });
  });
  it("returns only the minimal available contract for confirmed free state", () => {
    expect(employeeEligibility(employee, now, "free")).toEqual({ id: "employee", name: "Sam", available: true, reason: "available" });
  });
  it.each([
    [{ routingEnabled: false }, "routing_disabled"],
    [{ manualAvailability: "unavailable" }, "manual_unavailable"],
    [{ manualAvailability: "unknown" }, "manual_unknown"],
    [{ workingHours: { weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, exceptions: [] } }, "outside_hours"],
  ] satisfies [Partial<EmployeeEligibilityInput>, string][])("filters local restrictions %j", (patch, reason) => {
    expect(employeeEligibility({ ...employee, ...patch }, now, "free")).toMatchObject({ available: false, reason });
  });
  it("respects local closing boundaries, exceptions and busy providers", () => {
    expect(employeeEligibility(employee, new Date("2026-09-14T21:00:00Z"), "free").reason).toBe("outside_hours");
    expect(employeeEligibility({ ...employee, workingHours: { ...DEFAULT_BUSINESS_HOURS, exceptions: [{ date: "2026-09-14", intervals: [] }] } }, now, "free").reason).toBe("outside_hours");
    expect(employeeEligibility(employee, now, "busy").reason).toBe("provider_busy");
  });
});
