import resolveFrom from 'resolve-from';

/**
 * Check if the project is an Expo Router project
 */
export function isExpoRouterProject(projectRoot: string): boolean {
  return resolveFrom.silent(projectRoot, 'expo-router/package.json') != null;
}
