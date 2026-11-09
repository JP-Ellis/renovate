import upath from 'upath';
import { logger } from '../../../logger/index.ts';
import { getSiblingFileName, readLocalFile } from '../../../util/fs/index.ts';
import { newlineRegex, regEx } from '../../../util/regex.ts';
import type { GemspecLockFile } from './types.ts';

const gemNameRegex = regEx(
  /^[ \t]*[\w:.]+\.name\s*=\s*(?:'(?<single>[^']+)'|"(?<double>[^"]+)")/m,
);
const pathRemoteRegex = regEx(/^ {2}remote: (?<remote>.+)$/);
const pathSpecRegex = regEx(/^ {4}(?<name>\S+) \(/);

function getGemName(gemspecFile: string, gemspecContent: string): string {
  const groups = gemNameRegex.exec(gemspecContent)?.groups;
  return (
    groups?.single ?? groups?.double ?? upath.basename(gemspecFile, '.gemspec')
  );
}

/** Whether a `PATH` section of the lock file locks gem `gemName` from the lock file's own directory. */
function locksGemFromOwnDirectory(
  lockFileContent: string,
  gemName: string,
): boolean {
  let inPath = false;
  let remote: string | undefined;
  for (const line of lockFileContent.split(newlineRegex)) {
    if (!line.startsWith(' ')) {
      inPath = line.trim() === 'PATH';
      remote = undefined;
      continue;
    }
    if (!inPath) {
      continue;
    }
    const remoteMatch = pathRemoteRegex.exec(line);
    if (remoteMatch?.groups) {
      remote = remoteMatch.groups.remote.trim();
      continue;
    }
    const specName = pathSpecRegex.exec(line)?.groups?.name;
    if (
      specName === gemName &&
      remote !== undefined &&
      upath.normalizeTrim(remote) === '.'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Finds the sibling `Gemfile.lock` that Bundler resolved this gemspec into, through the `gemspec` directive of the sibling `Gemfile`.
 * Bundler records such a gemspec in a `PATH` section of the lock file, with `remote: .`.
 */
export async function findGemspecLockFile(
  gemspecFile: string,
  gemspecContent: string,
): Promise<GemspecLockFile | null> {
  const lockFile = getSiblingFileName(gemspecFile, 'Gemfile.lock');
  const lockFileContent = await readLocalFile(lockFile, 'utf8');
  if (!lockFileContent) {
    logger.debug(`gemspec: no sibling ${lockFile} for ${gemspecFile}`);
    return null;
  }
  const gemName = getGemName(gemspecFile, gemspecContent);
  if (!locksGemFromOwnDirectory(lockFileContent, gemName)) {
    logger.debug(
      `gemspec: ${lockFile} does not lock ${gemName} from its own directory, so it does not belong to ${gemspecFile}`,
    );
    return null;
  }
  return { lockFile, lockFileContent };
}
