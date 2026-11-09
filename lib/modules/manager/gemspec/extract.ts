import { RubygemsDatasource } from '../../datasource/rubygems/index.ts';
import { extractLockFileEntries } from '../bundler/locked-version.ts';
import type { PackageDependency, PackageFileContent } from '../types.ts';
import { findGemspecLockFile } from './lockfile.ts';
import { getRequirementValue, parseGemspec } from './parse.ts';

export async function extractPackageFile(
  content: string,
  packageFile?: string,
): Promise<PackageFileContent | null> {
  const deps = parseGemspec(content).map(
    ({ name, depType, requirements }): PackageDependency => {
      const dep: PackageDependency = {
        depName: name.value,
        depType,
        datasource: RubygemsDatasource.id,
        fileReplacePosition: name.tokenStart,
      };
      if (name.dynamic) {
        dep.skipReason = 'contains-variable';
      } else if (requirements) {
        dep.currentValue = getRequirementValue(requirements);
      } else {
        dep.skipReason = 'unspecified-version';
      }
      return dep;
    },
  );
  if (!deps.length) {
    return null;
  }
  const res: PackageFileContent = { deps };

  if (packageFile) {
    const lock = await findGemspecLockFile(packageFile, content);
    if (lock) {
      res.lockFiles = [lock.lockFile];
      const lockedVersions = extractLockFileEntries(lock.lockFileContent);
      for (const dep of deps) {
        const lockedVersion = lockedVersions.get(dep.depName!);
        if (lockedVersion) {
          dep.lockedVersion = lockedVersion;
        }
      }
    }
  }

  return res;
}
