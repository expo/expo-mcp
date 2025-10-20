import { glob } from 'glob';
import fs from 'node:fs';

export async function fileExistsAsync(filePath: string) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function directoryExistsAsync(dirPath: string) {
  try {
    const stat = await fs.promises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function existsAsync(path: string) {
  try {
    const stat = await fs.promises.stat(path);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

export async function findFilesAsync(pattern: string): Promise<string[]> {
  return await glob(pattern);
}

export function resolveProjectRoot(): string {
  return process.env['WORKSPACE_FOLDER_PATHS'] ?? process.cwd();
}
