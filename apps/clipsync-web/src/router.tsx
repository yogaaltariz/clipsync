import { createBrowserRouter } from 'react-router';
import { App } from './App.js';
import { BootPage } from './pages/BootPage.js';
import { MainPage } from './pages/MainPage.js';
import { PairHostPage } from './pages/PairHostPage.js';
import { PairScanPage } from './pages/PairScanPage.js';
import { PairSuccessPage } from './pages/PairSuccessPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { ItemDetailPage } from './pages/ItemDetailPage.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <BootPage /> },
      { path: 'main', element: <MainPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'item/:id', element: <ItemDetailPage /> },
      { path: 'pair/host', element: <PairHostPage /> },
      { path: 'pair/scan', element: <PairScanPage /> },
      { path: 'pair/success', element: <PairSuccessPage /> },
    ],
  },
]);
