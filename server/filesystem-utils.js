import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function decodeRouteParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
