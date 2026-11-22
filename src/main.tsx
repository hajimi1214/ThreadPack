import React from 'react';
import { createRoot } from 'react-dom/client';
import mascotIcon from './assets/mascot-icon-192.png';
import App from './App';
import './styles.css';
import './workspace.css';
import './landing.css';
import './interaction.css';
import './screen-fit.css';
import './snippets.css';
import './code-highlight.css';
import './motion.css';
import './markdown-preview.css';
import './projects/projects.css';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) { favicon.href = mascotIcon; favicon.type = 'image/png'; }

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
