import { describe, expect, it, vi } from "vitest";
import { RoomEvent, TrackSource } from "@livekit/rtc-node";
import { installBrowserHandoff } from "./browser-handoff.js";

function setup() {
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const room = { on: (event: string, listener: (...args: unknown[]) => unknown) => listeners.set(event, listener), remoteParticipants: new Map([["caller", {}]]) };
  const options = { room: room as never, callerIdentity: "caller", authorize: vi.fn().mockResolvedValue(true),
    removeRecipient: vi.fn().mockResolvedValue(undefined), shutdownAgent: vi.fn(), callerLeft: vi.fn().mockResolvedValue(undefined) };
  installBrowserHandoff(options);
  const recipient = { identity: "transfer-request", attributes: { transferRequestId: "request", transferUserId: "member" } };
  return { ...options, room, recipient, listeners,
    publish: (source = TrackSource.SOURCE_MICROPHONE) => listeners.get(RoomEvent.TrackSubscribed)!({}, { source }, recipient) };
}
describe("browser microphone handoff", () => {
  it("keeps the agent until an authorized recipient publishes microphone audio", async () => {
    const test = setup();
    expect(test.shutdownAgent).not.toHaveBeenCalled();
    await test.publish(TrackSource.SOURCE_CAMERA);
    expect(test.authorize).not.toHaveBeenCalled();
    await test.publish();
    expect(test.authorize).toHaveBeenCalledWith("request", "member");
    expect(test.shutdownAgent).toHaveBeenCalledTimes(1);
    await test.publish();
    expect(test.shutdownAgent).toHaveBeenCalledTimes(1);
  });
  it("serializes repeated track events so a valid teammate is not removed by a second claim", async () => {
    const test = setup();
    let finish: (value: boolean) => void = () => {};
    test.authorize.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = test.publish();
    await test.publish();
    expect(test.authorize).toHaveBeenCalledTimes(1);
    finish(true); await first;
    expect(test.removeRecipient).not.toHaveBeenCalled();
    expect(test.shutdownAgent).toHaveBeenCalledOnce();
  });
  it("removes an unauthorized recipient and keeps the agent", async () => {
    const test = setup(); test.authorize.mockResolvedValue(false);
    await test.publish();
    expect(test.removeRecipient).toHaveBeenCalledWith("transfer-request");
    expect(test.shutdownAgent).not.toHaveBeenCalled();
  });
  it("rejects pickup after the caller left", async () => {
    const test = setup(); test.room.remoteParticipants.clear();
    await test.publish();
    expect(test.authorize).not.toHaveBeenCalled();
    expect(test.removeRecipient).toHaveBeenCalledOnce();
    expect(test.shutdownAgent).not.toHaveBeenCalled();
  });
  it("ignores ordinary caller tracks and forged identities", async () => {
    const test = setup(); test.recipient.identity = "caller";
    await test.publish();
    expect(test.authorize).not.toHaveBeenCalled();
    expect(test.shutdownAgent).not.toHaveBeenCalled();
  });
});
