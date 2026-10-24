import React from 'react';
import { ChargeDashboard } from './ChargeDashboard.jsx';
import { NurseView } from './NurseView.jsx';

// Chooses the screen for a signed-in user. `view` comes from AuthGate, which
// derives it from the role GET /me reports ('charge' or 'nurse'). The screen
// choice is convenience; the API enforces every permission. There is no
// administrator route yet because the backend recognizes only nurse and
// charge_nurse.

// Both views read from the API: the nurse view loads the signed-in nurse's own
// workspace, and the charge nurse dashboard loads the full incident snapshot.
export function RoleView({ me, view, signOut, api, incidentId, onSessionExpired }) {
  if (view === 'charge') {
    return <ChargeDashboard me={me} onSignOut={signOut} api={api} incidentId={incidentId} onSessionExpired={onSessionExpired} />;
  }
  if (view === 'nurse') {
    return <NurseView me={me} onSignOut={signOut} api={api} incidentId={incidentId} onSessionExpired={onSessionExpired} />;
  }
  return null;
}
