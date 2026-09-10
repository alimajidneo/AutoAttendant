import { RoomEvent, TrackSource, type Room } from "@livekit/rtc-node";

type HandoffOptions = {
  room: Room;
  callerIdentity: string;
  authorize: (requestId: string, userId: string) => Promise<boolean>;
  removeRecipient: (identity: string) => Promise<unknown>;
  shutdownAgent: () => void;
  callerLeft: () => Promise<void>;
};

export function installBrowserHandoff(options: HandoffOptions) {
  const { room, callerIdentity } = options;
  let completing = false;
  let handedOff = false;
  room.on(RoomEvent.TrackSubscribed, async (_track, publication, remote) => {
    if (publication.source !== TrackSource.SOURCE_MICROPHONE || completing || handedOff) return;
    const id = remote.attributes["transferRequestId"];
    const userId = remote.attributes["transferUserId"];
    if (!id || !userId || remote.identity !== `transfer-${id}`) return;
    completing = true;
    try {
      if (room.remoteParticipants.has(callerIdentity) && await options.authorize(id, userId)) {
        handedOff = true;
        options.shutdownAgent();
      } else {
        await options.removeRecipient(remote.identity);
      }
    } catch {
      console.error("[transfer] Could not complete browser handoff");
      await options.removeRecipient(remote.identity).catch(() => console.error("[transfer] Could not remove unconfirmed recipient"));
    } finally { completing = false; }
  });
  room.on(RoomEvent.ParticipantDisconnected, remote => {
    if (remote.identity === callerIdentity) void options.callerLeft().catch(() => console.error("[transfer] Could not close request"));
  });
}
