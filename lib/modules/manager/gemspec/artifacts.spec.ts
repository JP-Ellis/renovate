import { codeBlock } from 'common-tags';
import { fs } from '~test/util.ts';
import * as _lock from '../bundler/lock.ts';
import type { UpdateArtifact } from '../types.ts';
import { updateArtifacts } from './artifacts.ts';

vi.mock('../../../util/fs/index.ts');
vi.mock('../bundler/lock.ts');

const lock = vi.mocked(_lock);

const updateArtifact: UpdateArtifact = {
  packageFileName: 'sub/foo.gemspec',
  updatedDeps: [{ depName: 'rack' }],
  newPackageFileContent: 'gem.add_dependency "rack", "~> 3.1"',
  config: {},
};

const lockFile = codeBlock`
  PATH
    remote: .
    specs:
      foo (1.0.0)
        rack (~> 3.0)

  GEM
    remote: https://rubygems.org/
    specs:
      rack (3.1.8)
`;

describe('modules/manager/gemspec/artifacts', () => {
  beforeEach(() => {
    fs.getSiblingFileName.mockImplementation(
      (_packageFile, otherFile) => `sub/${otherFile}`,
    );
  });

  it('returns null when there is no sibling Gemfile.lock', async () => {
    fs.readLocalFile.mockResolvedValueOnce(null);

    await expect(updateArtifacts(updateArtifact)).resolves.toBeNull();
    expect(lock.runBundlerLock).not.toHaveBeenCalled();
  });

  it.each`
    description                         | lockFileContent
    ${'a different gem'}                | ${lockFile.replace('foo (1.0.0)', 'bar (1.0.0)')}
    ${'the gem from another directory'} | ${lockFile.replace('remote: .', 'remote: ../foo')}
  `(
    'returns null when Gemfile.lock locks $description',
    async ({ lockFileContent }: { lockFileContent: string }) => {
      fs.readLocalFile.mockResolvedValueOnce(lockFileContent);

      await expect(updateArtifacts(updateArtifact)).resolves.toBeNull();
      expect(lock.runBundlerLock).not.toHaveBeenCalled();
    },
  );

  it.each`
    remote
    ${'.'}
    ${'./'}
  `(
    'delegates to runBundlerLock when Gemfile.lock locks the gemspec from `$remote`',
    async ({ remote }: { remote: string }) => {
      fs.readLocalFile.mockResolvedValueOnce(
        lockFile.replace('remote: .', `remote: ${remote}`),
      );
      const result = [
        {
          file: {
            type: 'addition' as const,
            path: 'sub/Gemfile.lock',
            contents: 'x',
          },
        },
      ];
      lock.runBundlerLock.mockResolvedValueOnce(result);

      await expect(updateArtifacts(updateArtifact)).resolves.toBe(result);
      expect(fs.readLocalFile).toHaveBeenCalledWith('sub/Gemfile.lock', 'utf8');
      expect(lock.runBundlerLock).toHaveBeenCalledWith(
        updateArtifact,
        'sub/Gemfile.lock',
      );
    },
  );
});
