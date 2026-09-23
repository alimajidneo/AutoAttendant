import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../../lib/queries", () => ({ keys: { employeeSelf: ["employee-self"] }, fetchers: { employeeSelf: vi.fn() } }));
vi.mock("../../lib/apiClient", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.data, isPending: false, isError: false, refetch: vi.fn() }) }));

import EmployeeSelfPage from "./EmployeeSelfPage";

it("offers linked members self-service Google, Microsoft, and Cal.com connections", () => {
  mocks.data = {
    configured: true,
    employee: { id: "employee", displayName: "Thomas" },
    connection: null,
    directCalendars: { providers: { google: true, microsoft: true }, connections: [] },
  };
  const html = renderToStaticMarkup(<EmployeeSelfPage />);
  for (const text of ["Thomas", "Connect Google", "Connect Microsoft", "Connect Cal.com", "Select all five", "Open Cal.com calendar settings"]) expect(html).toContain(text);
  expect(html.indexOf("Cal.com · one booking schedule")).toBeGreaterThan(-1);
  expect(html).toContain("Direct Google and Microsoft connections");
  for (const forbidden of ["API key", "event type ID", "webhook", "client secret"]) expect(html).not.toContain(forbidden);
});

it("shows only the linked member's connected direct-calendar accounts", () => {
  mocks.data = {
    configured: false,
    employee: { id: "employee", displayName: "Thomas" },
    connection: null,
    directCalendars: {
      providers: { google: true, microsoft: true },
      connections: [{ id: "own", provider: "google", accountEmail: "thomas@example.test", accountName: "Thomas" }],
    },
  };
  const html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("thomas@example.test");
  expect(html).toContain("Use direct connections when your manager chooses that calendar authority");
  expect(html).not.toContain("other@example.test");
});

it("shows readiness and clear unconfigured or unlinked states without credentials", () => {
  mocks.data = { configured: true, employee: { id: "employee", displayName: "Thomas", bookingConfigured: true }, connection: { ready: true, status: "active", accountEmail: "thomas@example.test", eventTypeTitle: "DeskRoute appointment", encryptedCredential: "PRIVATE" } };
  let html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("Ready");
  expect(html).toContain("Calendar setup configured");
  expect(html).toContain("thomas@example.test");
  expect(html).not.toContain("PRIVATE");
  mocks.data = { configured: false, employee: { id: "employee", displayName: "Thomas" }, connection: null };
  html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("not configured");
  expect(html).toContain("Manager must approve a booking destination");
  mocks.data = { configured: true, employee: null, connection: null };
  expect(renderToStaticMarkup(<EmployeeSelfPage />)).toContain("not linked");
});

it("shows a ready manager-owned Cal.com connection when hosted OAuth is unavailable", () => {
  mocks.data = {
    configured: false,
    employee: { id: "employee", displayName: "Thomas", bookingConfigured: true },
    connection: { authKind: "api_key", ready: true, accountEmail: "thomas@example.test" },
  };
  const html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("Ready for DeskRoute bookings");
  expect(html).toContain("thomas@example.test");
  expect(html).not.toContain("Cal.com employee OAuth is not configured");
});
