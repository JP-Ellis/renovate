import { codeBlock } from 'common-tags';
import { fs } from '~test/util.ts';
import type { PackageFileContent } from '../types.ts';
import { extractPackageFile as extract } from './extract.ts';

vi.mock('../../../util/fs/index.ts');

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
      rspec (3.13.0)

  PLATFORMS
    ruby

  DEPENDENCIES
    foo!
    rspec (~> 3.13)
`;

function skipped(depNames: string[], skipReason: string): object[] {
  return depNames.map((depName) => ({
    depName,
    depType: 'runtime',
    datasource: 'rubygems',
    skipReason,
  }));
}

/** Extracts without `fileReplacePosition`, which has its own test. */
async function extractPackageFile(
  content: string,
  packageFile?: string,
): Promise<PackageFileContent | null> {
  const res = await extract(content, packageFile);
  return (
    res && {
      ...res,
      deps: res.deps.map(({ fileReplacePosition: _, ...dep }) => dep),
    }
  );
}

describe('modules/manager/gemspec/extract', () => {
  it('points fileReplacePosition at the start of each gem name literal', async () => {
    const content = codeBlock`
      spec.add_dependency 'rack', '~> 3.0'
      spec.add_dependency(%q<rake>.freeze, ["~> 13.0".freeze])
      spec.add_dependency "foo"; spec.add_dependency "bar", "~> 1.0"
    `;

    const res = await extract(content);

    expect(
      res?.deps.map(({ fileReplacePosition }) =>
        content.slice(fileReplacePosition, fileReplacePosition! + 8),
      ),
    ).toEqual([`'rack', `, '%q<rake>', '"foo"; s']);
  });

  beforeEach(() => {
    fs.getSiblingFileName.mockImplementation(
      (_packageFile, otherFile) => `sub/${otherFile}`,
    );
  });

  it('returns null when there are no dependencies', async () => {
    await expect(extractPackageFile('')).resolves.toBeNull();
    await expect(
      extractPackageFile('Gem::Specification.new { |s| s.name = "x" }'),
    ).resolves.toBeNull();
  });

  it('extracts runtime, development and bare dependencies', async () => {
    const content = codeBlock`
      Gem::Specification.new do |gem|
        gem.add_runtime_dependency "semantic_logger", "~> 4.11"
        gem.add_development_dependency 'pstore', '~> 0.1'
        gem.add_dependency "rack", "~> 3.0"
      end
    `;

    const res = await extractPackageFile(content);

    expect(res).toEqual({
      deps: [
        {
          depName: 'semantic_logger',
          depType: 'runtime',
          datasource: 'rubygems',
          currentValue: '~> 4.11',
        },
        {
          depName: 'pstore',
          depType: 'development',
          datasource: 'rubygems',
          currentValue: '~> 0.1',
        },
        {
          depName: 'rack',
          depType: 'runtime',
          datasource: 'rubygems',
          currentValue: '~> 3.0',
        },
      ],
    });
  });

  it('captures multi-part restriction constraints in full', async () => {
    const content = `spec.add_runtime_dependency "activesupport", "~> 4.2", '!= 4.2.5', ">= 4.2.1"`;

    const res = await extractPackageFile(content);

    expect(res?.deps[0]).toEqual({
      depName: 'activesupport',
      depType: 'runtime',
      datasource: 'rubygems',
      currentValue: '~> 4.2, != 4.2.5, >= 4.2.1',
    });
  });

  it('handles parentheses and trailing comments', async () => {
    const content = codeBlock`
      spec.add_dependency("graphql", "~> 1.9.19") # pinned intentionally
      spec.add_dependency "hashie", "~> 5.0" # see #123
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps.map(({ currentValue }) => currentValue)).toEqual([
      '~> 1.9.19',
      '~> 5.0',
    ]);
  });

  it('extracts declarations that span several lines', async () => {
    const content = codeBlock`
      Gem::Specification.new do |spec|
        spec.add_dependency 'activesupport',
                            '>= 6.1', # oldest supported
                            '< 8'
        spec.add_dependency(
          'rack',
          '~> 3.0',
        )
        spec.add_dependency 'zeitwerk', '~> 2.6'
      end
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual([
      {
        depName: 'activesupport',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '>= 6.1, < 8',
      },
      {
        depName: 'rack',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 3.0',
      },
      {
        depName: 'zeitwerk',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 2.6',
      },
    ]);
  });

  it('extracts the forms that RubyGems writes into generated gemspecs', async () => {
    const content = codeBlock`
      Gem::Specification.new do |s|
        s.name = "foo".freeze
        s.add_runtime_dependency(%q<rack>.freeze, ["~> 3.0".freeze])
        s.add_development_dependency(%q<rspec>.freeze, [">= 3.12".freeze, "< 4".freeze])
        s.add_dependency %q{rake}, "~> 13.0".freeze
      end
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual([
      {
        depName: 'rack',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 3.0',
      },
      {
        depName: 'rspec',
        depType: 'development',
        datasource: 'rubygems',
        currentValue: '>= 3.12, < 4',
      },
      {
        depName: 'rake',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 13.0',
      },
    ]);
  });

  it('extracts constraints given as an array', async () => {
    const content = codeBlock`
      spec.add_dependency 'rails', ['>= 7.0', '< 8.1']
      spec.add_dependency 'puma', [
        '>= 6.0',
        '< 7',
      ]
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps.map(({ currentValue }) => currentValue)).toEqual([
      '>= 7.0, < 8.1',
      '>= 6.0, < 7',
    ]);
  });

  it('skips dependencies without a literal version', async () => {
    const content = codeBlock`
      spec.add_dependency "rake"
      spec.add_runtime_dependency "foo", Foo::VERSION
      spec.add_dependency "bar", "~> 1.0", Bar::VERSION
      spec.add_dependency "baz", ["~> 1.0"], "!= 1.0.1"
      spec.add_dependency "qux", "~> 1.0" if RUBY_VERSION >= "3.0"
      spec.add_dependency("quux", "~> 1.0"
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual(
      skipped(
        ['rake', 'foo', 'bar', 'baz', 'qux', 'quux'],
        'unspecified-version',
      ),
    );
  });

  it('handles CRLF line endings and a call left open at the end of the file', async () => {
    const content = [
      "spec.add_dependency 'rack',",
      "  '~> 3.0'",
      "spec.add_dependency('rake', # no closing parenthesis",
    ].join('\r\n');

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual([
      {
        depName: 'rack',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 3.0',
      },
      ...skipped(['rake'], 'unspecified-version'),
    ]);
  });

  it('skips interpolated or escaped version strings wherever they appear', async () => {
    const content = [
      'spec.add_dependency "foo", "~> #{Foo::VERSION}"',
      `spec.add_runtime_dependency 'bar', ">= 1.0", "< #{major + 1}"`,
      'spec.add_dependency "baz", %Q{~> #{BAZ}}',
      'spec.add_dependency "qux", "~> 1.0\\n"',
    ].join('\n');

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual(
      skipped(['foo', 'bar', 'baz', 'qux'], 'unspecified-version'),
    );
  });

  it('keeps literal hashes in single-quoted and %q strings', async () => {
    const content = codeBlock`
      spec.add_dependency 'foo', '~> 1.0' # '#{not} interpolated'
      spec.add_dependency %q<bar>, %q(~> 2.0)
      spec.add_dependency 'baz', %q{#{literal}}
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps.map(({ currentValue }) => currentValue)).toEqual([
      '~> 1.0',
      '~> 2.0',
      '#{literal}',
    ]);
  });

  it('skips interpolated dependency names', async () => {
    const content = codeBlock`
      %w[core model controller].each do |variant|
        spec.add_dependency "my-framework-#{variant}", '~> 1.0'
      end
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual(
      skipped(['my-framework-#{variant}'], 'contains-variable'),
    );
  });

  it('ignores declarations with a non-literal name or inside comments', async () => {
    const content = codeBlock`
      Gem::Specification.new do |spec|
        # spec.add_dependency "foo", "~> 1.0"
        spec.add_dependency name, "~> 1.0"
        spec.add_dependency "bar
        spec.add_dependency "baz", "~> 2.0"
      end
      spec.add_dependency "qux
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual([
      {
        depName: 'baz',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 2.0',
      },
    ]);
  });

  it('extracts semicolon-joined declarations', async () => {
    const content = codeBlock`
      spec.add_dependency "foo", "~> 1.0"; spec.add_dependency "bar", "~> 2.0"
      spec.add_dependency "baz"; spec.add_dependency "qux", "~> 3.0"
    `;

    const res = await extractPackageFile(content);

    expect(res?.deps).toEqual([
      {
        depName: 'foo',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 1.0',
      },
      {
        depName: 'bar',
        depType: 'runtime',
        datasource: 'rubygems',
        currentValue: '~> 2.0',
      },
      {
        depName: 'baz',
        depType: 'runtime',
        datasource: 'rubygems',
        skipReason: 'unspecified-version',
      },
    ]);
  });

  describe('lock file', () => {
    const content = codeBlock`
      Gem::Specification.new do |spec|
        spec.name = 'foo'
        spec.add_dependency 'rack', '~> 3.0'
        spec.add_development_dependency 'rspec', '~> 3.13'
        spec.add_development_dependency 'rake', '~> 13.0'
      end
    `;

    it('sets lockedVersion from the sibling Gemfile.lock that locks the gemspec', async () => {
      fs.readLocalFile.mockResolvedValueOnce(lockFile);

      const res = await extractPackageFile(content, 'sub/foo.gemspec');

      expect(fs.readLocalFile).toHaveBeenCalledWith('sub/Gemfile.lock', 'utf8');
      expect(res).toEqual({
        lockFiles: ['sub/Gemfile.lock'],
        deps: [
          {
            depName: 'rack',
            depType: 'runtime',
            datasource: 'rubygems',
            currentValue: '~> 3.0',
            lockedVersion: '3.1.8',
          },
          {
            depName: 'rspec',
            depType: 'development',
            datasource: 'rubygems',
            currentValue: '~> 3.13',
            lockedVersion: '3.13.0',
          },
          {
            depName: 'rake',
            depType: 'development',
            datasource: 'rubygems',
            currentValue: '~> 13.0',
          },
        ],
      });
    });

    it('matches the gem by file name when the gemspec has no literal name', async () => {
      fs.readLocalFile.mockResolvedValueOnce(lockFile);

      const res = await extractPackageFile(
        `spec.add_dependency 'rack', '~> 3.0'`,
        'sub/foo.gemspec',
      );

      expect(res?.lockFiles).toEqual(['sub/Gemfile.lock']);
      expect(res?.deps[0].lockedVersion).toBe('3.1.8');
    });

    it('ignores a missing Gemfile.lock', async () => {
      fs.readLocalFile.mockResolvedValueOnce(null);

      const res = await extractPackageFile(content, 'sub/foo.gemspec');

      expect(res?.lockFiles).toBeUndefined();
      expect(res?.deps[0].lockedVersion).toBeUndefined();
    });

    it.each`
      description                               | lockFileContent
      ${'locks a different gem'}                | ${lockFile.replace('foo (1.0.0)', 'bar (1.0.0)')}
      ${'locks the gem from another directory'} | ${lockFile.replace('remote: .', 'remote: ../foo')}
      ${'has no PATH section'}                  | ${lockFile.replace(/^PATH[\s\S]*?\n\n/, '')}
    `(
      'ignores a Gemfile.lock that $description',
      async ({ lockFileContent }: { lockFileContent: string }) => {
        fs.readLocalFile.mockResolvedValueOnce(lockFileContent);

        const res = await extractPackageFile(content, 'sub/foo.gemspec');

        expect(res?.lockFiles).toBeUndefined();
        expect(res?.deps[0].lockedVersion).toBeUndefined();
      },
    );
  });
});
