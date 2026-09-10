# Phone, SIM and SIP integration sequence

Updated 2026-09-10. This is planned work; human call transfer is not implemented.

## What connects to DeskRoute

A SIM identifies a mobile subscription. SIP connects phone systems and LiveKit; they are different things. A physical SIM is not inserted into the website, API or Vercel deployment.

For an existing mobile number, the practical first test is carrier-supported call forwarding to a test number connected to LiveKit/Mike's system. Whether unconditional or busy/no-answer forwarding is available, what caller ID survives and what it costs must be verified with that mobile carrier. For an existing business VoIP number, ask Mike to provide a test route/trunk or extension in his phone system. Do not assume his provider supports every SIP feature.

LiveKit documents [inbound telephony](https://docs.livekit.io/telephony/) and [SIP REFER transfers](https://docs.livekit.io/telephony/features/transfers/cold/). Transfers require compatible provider configuration. [Assisted transfers](https://docs.livekit.io/telephony/features/transfers/warm/) let the recipient receive context and allow a return to the caller when unavailable.

## When to integrate

1. **Now:** obtain Mike's provider/product name, account access arrangement, test number/trunk, inbound routing, transfer support, outbound rates, caller ID behavior and any presence API. Confirm the actual customer's current number/carrier.
2. **After this dashboard batch:** perform a small real-number connectivity test with the existing receptionist. Basic inbound audio/booking testing need not wait for Microsoft or complete workspaces. Keep the worker running and test only a temporary number/route.
3. **Before a shared team pilot:** implement workspaces, employee permissions, departments, approved destinations, transfer hours and message/booking fallback. Calendar availability alone cannot prove someone is off the phone.
4. **Then:** test one human destination with assisted transfer, acceptance/decline, timeout, busy/no-answer, caller hang-up and recipient hang-up. Measure usage for the inbound/outbound legs and AI processing.
5. **Then:** test department primary/backup routing, followed by Slack approval if required. Prefer existing PBX ring groups where appropriate.
6. **Before customer handover:** deploy stable website/API and worker, complete calendar/provider failure checks, then arrange business-number forwarding. Port the main number only after acceptance and a cutover/rollback plan are agreed.

The initial design is one primary recipient, one backup and a bounded wait, then booking or a message. Administrators configure destinations; the model chooses an authorized directory entry rather than an arbitrary caller-supplied number. Voice/media processing stays in LiveKit/the persistent worker, not a long Vercel request.

No number has been purchased, forwarded or ported as part of the notification/calendar-color batch. No SIM gateway is required for this proposed standard setup.
