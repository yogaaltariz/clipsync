import { createBrowserRouter } from 'react-router';
import { App } from './App.js';

// Route tree is a placeholder — the real screens (main, settings, pairing,
// item detail) are built as their own reviewed tasks per the frontend
// implementation plan, against the Paper.design artboards.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
]);
