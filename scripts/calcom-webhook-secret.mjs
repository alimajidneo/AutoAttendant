#!/usr/bin/env node
import { createHmac } from 'node:crypto';

// Local operator utility: no application env loader, filesystem reads or network.
// Keep the domain separator identical to deriveCalcomWebhookSecret (tested).
const [connectionId, ...extra] = process.argv.slice(2);
const root = process.env.CALCOM_WEBHOOK_SECRET;
if (extra.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(connectionId ?? '')
 || typeof root !== 'string' || root.length < 32 || !root.trim()) {
 process.stderr.write('Invalid connection ID or webhook root configuration.\n');
 process.exitCode = 1;
} else {
 process.stdout.write(createHmac('sha256', root).update(`deskroute-calcom-webhook:${connectionId}`).digest('hex') + '\n');
}
