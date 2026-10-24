import React from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell.jsx';

// App entry point. Mounts the role-routing shell, which shows the login screen
// or the signed-in user's role experience. Frontend only — no backend.
createRoot(document.getElementById('root')).render(<AppShell />);
