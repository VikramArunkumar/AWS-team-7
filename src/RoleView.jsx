import React from 'react';
import { App as ChargeNurseDashboard } from './main.jsx';
import { NurseView } from './NurseView.jsx';

// Chooses the screen for a signed-in user. `view` comes from AuthGate, which
// derives it from the role GET /me reports ('charge' or 'nurse'). The screen
// choice is convenience; the API enforces every permission. There is no
// administrator route yet because the backend recognizes only nurse and
// charge_nurse.

// The nurse view reads the signed-in nurse's own workspace from the API, so
// every provisioned nurse gets it; one with no assignments sees empty states.
// The charge nurse dashboard still renders fixtures from src/data.js.
export function RoleView({ me, view, signOut, api, incidentId, onSessionExpired }) {
  if (view === 'charge') return <ChargeNurseDashboard me={me} onSignOut={signOut} />;
  if (view === 'nurse') {
    return <NurseView me={me} onSignOut={signOut} api={api} incidentId={incidentId} onSessionExpired={onSessionExpired} />;
  }
  return null;
}
