import type { BusinessHours } from "./index.js";
export type EmployeeCalendarReference = { connectionId: string; calendarId: string };
export type EmployeeCalendarPolicy =
  | { authority: "direct"; booking: EmployeeCalendarReference | null; conflicts: EmployeeCalendarReference[] }
  | { authority: "calcom"; eventType: string | null; bookingUrl: string | null; connectionId?: string; eventTypeId?: number; eventTypeSlug?: string; eventTypeTitle?: string };
export type EmployeeDraft = {
  displayName: string;
  department?: string | null;
  routingEnabled?: boolean;
  manualAvailability?: "available" | "unavailable" | "unknown";
  timezone: string;
  workingHours?: BusinessHours;
  transferNumber?: string | null;
};
export type EmployeeView = {
  id: string; displayName: string; department: string | null;
  routingEnabled: boolean; manualAvailability: "available" | "unavailable" | "unknown";
  timezone: string; workingHours: BusinessHours; calendarPolicy: EmployeeCalendarPolicy;
  hasTransferDestination: boolean; transferDestinationDisplay: string | null;
  createdAt: string; updatedAt: string;
};
export type EmployeeConnectionView = {
  id: string; employeeId: string | null; provider: "google" | "microsoft";
  accountEmail: string; accountName: string | null;
};
