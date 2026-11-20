import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './workspace.css';
import './landing.css';
import './interaction.css';
import './screen-fit.css';
import './snippets.css';
import './code-highlight.css';
import './motion.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
