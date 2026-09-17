import { Outlet } from 'react-router';
import { AppStateProvider } from './lib/appState.js';

export function App() {
  return (
    <AppStateProvider>
      <Outlet />
    </AppStateProvider>
  );
}
