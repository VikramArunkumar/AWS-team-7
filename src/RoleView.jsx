import React from 'react';
import { App as ChargeNurseDashboard, NurseView } from './main.jsx';
import { NurseHome } from './NurseHome.jsx';
import { nurses } from './data.js';

// Chooses the screen for a signed-in user. `view` comes from AuthGate, which
// derives it from the role GET /me reports ('charge' or 'nurse'). The screen
// choice is convenience; the API enforces every permission. There is no
// administrator route yet because the backend recognizes only nurse and
// charge_nurse.

// The nurse view renders fixture shift data. Show it only when the account's
// CareBridge user id matches a fixture nurse (n1-n6 in the backend seed);
// otherwise show the minimal signed-in screen rather than another nurse's data.
export const hasDemoShift = (me) => nurses.some((nurse) => nurse.id === me?.userId);

export function RoleView({ me, view, signOut }) {
  if (view === 'charge') return <ChargeNurseDashboard me={me} onSignOut={signOut} />;
  if (view === 'nurse') {
    return hasDemoShift(me)
      ? <NurseView me={me} onSignOut={signOut} />
      : <NurseHome me={me} onSignOut={signOut} />;
  }
  return null;
}
