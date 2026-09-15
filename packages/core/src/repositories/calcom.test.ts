import { expect, it } from 'vitest';
import { calcomConnectionView } from './calcom.js';
import { encryptToken } from '../providers/token-encryption.js';
import type { calcomConnections } from '../db/schema.js';
it('allowlists the connection view and never returns plaintext or ciphertext', () => {
 const encryptedCredential = encryptToken('PRIVATE_KEY', 'calcom:tenant:connection', '12'.repeat(32));
 const row = { id: 'connection', employeeId: 'employee', agentId: 'tenant', authKind: 'api_key', encryptedCredential, providerUserId: '1', accountEmail: 'employee@example.test', displayLabel: 'Employee', status: 'active', createdAt: new Date(), updatedAt: new Date() } as typeof calcomConnections.$inferSelect;
 const view = calcomConnectionView(row);
 expect(Object.keys(view).sort()).toEqual(['accountEmail', 'authKind', 'displayLabel', 'employeeId', 'id', 'providerUserId', 'ready', 'status']);
 expect(JSON.stringify(view)).not.toContain(encryptedCredential); expect(JSON.stringify(view)).not.toContain('PRIVATE_KEY');
});
