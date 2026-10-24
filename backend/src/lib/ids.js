// ID and timestamp helpers.
import { randomUUID } from 'node:crypto';

export const uuid = () => randomUUID();

export const nowIso = () => new Date().toISOString();

// Human-friendly, prefixed IDs for demo readability (e.g. UPD-ab12cd34).
// Uniqueness comes from the random suffix, not the prefix.
const shortId = () => randomUUID().replace(/-/g, '').slice(0, 8);

export const newUpdateId = () => `UPD-${shortId()}`;
export const newTaskId = () => `TSK-${shortId()}`;
export const newRecId = () => `REC-${shortId()}`;
export const newIncidentId = () => `INC-${shortId()}`;
