import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';

// Dev-only QA hook — lets automated tests drive the real store and place
// real catalog items. Stripped from production builds by the DEV guard.
if (import.meta.env.DEV) {
  Promise.all([
    import('./stores/useStore'),
    import('./utils/itemBuilder'),
    import('./constants/equipmentLibrary'),
    import('./importers/roomplan'),
    import('./templates'),
  ]).then(([store, builder, lib, roomplan, templates]) => {
    (window as any).__qa = {
      useStore: store.useStore,
      buildItemFromTemplate: builder.buildItemFromTemplate,
      EQUIPMENT: lib.EQUIPMENT,
      parseRoomPlanJSON: roomplan.parseRoomPlanJSON,
      TEMPLATES: templates.TEMPLATES,
    };
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
