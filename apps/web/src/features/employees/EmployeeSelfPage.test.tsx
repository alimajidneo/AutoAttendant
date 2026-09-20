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
  for (const text of ["Thomas", "Connect Google", "Connect Microsoft", "Connect Cal.com"]) expect(html).toContain(text);
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
  expect(html).toContain("A manager chooses which connected calendars control bookings and conflicts");
  expect(html).not.toContain("other@example.test");
});

it("shows readiness and clear unconfigured or unlinked states without credentials", () => {
  mocks.data = { configured: true, employee: { id: "employee", displayName: "Thomas" }, connection: { ready: true, status: "active", accountEmail: "thomas@example.test", eventTypeTitle: "DeskRoute appointment", encryptedCredential: "PRIVATE" } };
  let html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("Ready");
  expect(html).toContain("thomas@example.test");
  expect(html).not.toContain("PRIVATE");
  mocks.data = { configured: false, employee: { id: "employee", displayName: "Thomas" }, connection: null };
  html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("not configured");
  mocks.data = { configured: true, employee: null, connection: null };
  expect(renderToStaticMarkup(<EmployeeSelfPage />)).toContain("not linked");
});
