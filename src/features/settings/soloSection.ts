import { createContext } from 'react';

/**
 * Set by a settings sub-page that shows a single group: its own h1 already names the group,
 * so the group's h2 stays for screen readers only.
 */
export const SoloSectionContext = createContext(false);
