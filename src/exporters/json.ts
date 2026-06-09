import { saveAs } from 'file-saver';
import type { ProjectFile } from '../types';
import {
  PROJECT_SCHEMA_VERSION, MAX_SHARE_PAYLOAD, coerceProject,
} from '../engine/projectValidation';

export function buildProjectFile(state: any): ProjectFile {
  return {
    meta: state.meta,
    room: state.room,
    equipment: state.equipment,
    zones: state.zones,
    groups: state.groups,
    simulation: { noiseFloor: state.noiseFloor },
    compliance: state.compliance,
    scenarios: state.scenarios,
    activeScenarioId: state.activeScenarioId,
    annotations: state.annotations,
    connections: state.connections,
    // Schema version stamp — lets a future loader detect & migrate old saves.
    schemaVersion: PROJECT_SCHEMA_VERSION,
  };
}

export function exportJSON(file: ProjectFile, filename = 'project.json') {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  saveAs(blob, filename);
}

export function exportBavl(file: ProjectFile, filename = 'project.bavl') {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  saveAs(blob, filename);
}

/**
 * Read + validate a project file. Throws a friendly Error on a malformed
 * or unusable file so the caller can show the message to the user — never
 * lets unvalidated data through to the store.
 */
export async function importProjectFile(file: File): Promise<ProjectFile> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read the file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON — it may be corrupted or truncated.');
  }
  const result = coerceProject(parsed);
  if (!result) {
    throw new Error('This does not look like a valid Beacon project file.');
  }
  return result;
}

export function buildShareLink(file: ProjectFile): string {
  const json = JSON.stringify(file);
  // Compress with base64 only (URL hash). For real apps we'd lz-string; this works for moderate sizes.
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : '';
  return `${location.origin}${location.pathname}#bavl=${b64}`;
}

export function tryDecodeShareHash(): ProjectFile | null {
  const hash = location.hash;
  const m = hash.match(/#bavl=(.+)/);
  if (!m) return null;
  // Reject implausibly large payloads before decoding — a multi-MB hash is
  // junk or an attack and atob/parse would jank the main thread.
  if (m[1].length > MAX_SHARE_PAYLOAD) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    return coerceProject(JSON.parse(json));
  } catch {
    return null;
  }
}
