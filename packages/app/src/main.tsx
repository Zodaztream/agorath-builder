/**
 * Entry point. There is no router: three screens, one of them at a time, and a
 * router would be a dependency with nothing to do.
 */

import { render } from 'preact';
import { App } from './app.tsx';
import './styles.css';

const mount = document.getElementById('app');
if (mount !== null) render(<App />, mount);
