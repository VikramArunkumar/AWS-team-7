// Small presentational components shared by the charge and nurse views.
import React from 'react';

export function Badge({ children, tone = 'neutral' }) { return <span className={`badge ${tone}`}>{children}</span>; }

// `person` is { initials, tone } (see staffDirectory in src/charge/dashboard.js).
export function Avatar({ person, small = false }) { return <span className={`avatar ${person?.tone ?? ''} ${small ? 'small' : ''}`} aria-hidden="true">{person?.initials ?? '?'}</span>; }

export function Priority({ value }) { return <Badge tone={value === 'High' ? 'red' : value === 'Moderate' ? 'amber' : 'green'}><span className="status-dot" />{value ?? 'Not set'}</Badge>; }

export const statusTone = (status) => status === 'Completed' ? 'green' : (status === 'Delayed' || status === 'Unable to complete') ? 'red' : status === 'Unconfirmed' ? 'amber' : 'teal';
