import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../../lib/queries", () => ({ keys: { employeeSelf: ["employee-self"] }, fetchers: { employeeSelf: vi.fn() } }));
vi.mock("../../lib/apiClient", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.data, isPending: false, isError: false, refetch: vi.fn() }) }));

import EmployeeSelfPage from "./EmployeeSelfPage";

it("shows only self-service OAuth controls and no manual Cal.com fields", () => {
  mocks.data = { configured: true, employee: { id: "employee", displayName: "Thomas" }, connection: null };
  const html = renderToStaticMarkup(<EmployeeSelfPage />);
  expect(html).toContain("Thomas");
  expect(html).toContain("Connect Cal.com");
  for (const forbidden of ["API key", "event type ID", "webhook", "client secret"]) expect(html).not.toContain(forbidden);
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
