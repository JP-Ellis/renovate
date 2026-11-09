import { logger } from '../../../logger/index.ts';
import { runBundlerLock } from '../bundler/lock.ts';
import type { UpdateArtifact, UpdateArtifactsResult } from '../types.ts';
import { findGemspecLockFile } from './lockfile.ts';

export async function updateArtifacts(
  updateArtifact: UpdateArtifact,
): Promise<UpdateArtifactsResult[] | null> {
  const { packageFileName, newPackageFileContent } = updateArtifact;
  const lock = await findGemspecLockFile(
    packageFileName,
    newPackageFileContent,
  );
  if (!lock) {
    logger.debug(`gemspec: skipping lock refresh for ${packageFileName}`);
    return null;
  }
  return runBundlerLock(updateArtifact, lock.lockFile);
}
