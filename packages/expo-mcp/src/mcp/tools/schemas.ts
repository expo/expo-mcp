import { z } from 'zod';

/**
 * Shared input schemas reused across tools, so the description and validation
 * for common params stay consistent and live in one place.
 */

/** Absolute path to the project root. Passed per call so one server can work with multiple projects. */
export const projectRootInput = z.string().describe('Absolute path to the project root.');

/** Target platform; falls back to the currently running platform when omitted. */
export const platformInput = z.enum(['android', 'ios']).optional();
