import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { deriveCalcomWebhookSecret } from '../src/providers/calcom.js';
const script = fileURLToPath(new URL('../../../scripts/calcom-webhook-secret.mjs', import.meta.url));
const root = 'test-root-secret-never-print-this-value';
const id = '11111111-1111-4111-8111-111111111111';
function run(args: string[], secret?: string) {
 return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...(secret === undefined ? {} : { CALCOM_WEBHOOK_SECRET: secret }) } });
}
it('outputs only the deterministic per-connection 64-hex secret, matching server HMAC separation', () => {
 const first = run([id], root), second = run([id], root);
 expect(first.status).toBe(0); expect(first.stderr).toBe('');
 expect(first.stdout).toMatch(/^[a-f0-9]{64}\n$/);
 expect(first.stdout).toBe(deriveCalcomWebhookSecret(root, id) + '\n');
 expect(second.stdout).toBe(first.stdout);
 expect(run(['22222222-2222-4222-8222-222222222222'], root).stdout).not.toBe(first.stdout);
 expect(first.stdout + first.stderr).not.toContain(root);
});
it.each([
 { args: [id], secret: undefined }, { args: [id], secret: 'short' },
 { args: [], secret: root }, { args: ['invalid'], secret: root },
 { args: ['ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF'], secret: root },
 { args: [id, root], secret: root },
])('fails closed without printing secrets or invalid arguments', ({ args, secret }) => {
 const result = run(args, secret);
 expect(result.status).toBe(1); expect(result.stdout).toBe('');
 expect(result.stderr).toBe('Invalid connection ID or webhook root configuration.\n');
 expect(result.stdout + result.stderr).not.toContain(root);
});
