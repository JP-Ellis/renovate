import { codeBlock } from 'common-tags';
import { api as rubyVersioning } from '../../versioning/ruby/index.ts';
import type { Upgrade } from '../types.ts';
import { extractPackageFile } from './extract.ts';
import { updateDependency } from './update.ts';

async function getUpgrade(
  fileContent: string,
  depIndex: number,
  newVersion: string,
  currentVersion: string,
): Promise<Upgrade> {
  const dep = (await extractPackageFile(fileContent))!.deps[depIndex];
  return {
    ...dep,
    newValue: rubyVersioning.getNewValue({
      currentValue: dep.currentValue!,
      rangeStrategy: 'replace',
      currentVersion,
      newVersion,
    })!,
  };
}

describe('modules/manager/gemspec/update', () => {
  it('bumps a simple constraint', async () => {
    const fileContent = codeBlock`
      Gem::Specification.new do |spec|
        spec.add_dependency "rails", "~> 6.0"
      end
    `;
    const upgrade = await getUpgrade(fileContent, 0, '7.1.0', '6.0.0');

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(upgrade.newValue).toBe('~> 7.0');
    expect(res).toBe(fileContent.replace('"~> 6.0"', '"~> 7.0"'));
  });

  it('rewrites only the parts of a compound constraint that change, keeping their quotes', async () => {
    const fileContent = codeBlock`
      Gem::Specification.new do |spec|
        spec.add_runtime_dependency "activesupport", "~> 4.2", '< 5.5',  ">= 4.2.1"
      end
    `;
    const upgrade = await getUpgrade(fileContent, 0, '6.0.0', '4.2.1');

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(upgrade.newValue).toBe('~> 6.0, < 6.0.1, >= 4.2.1');
    expect(res).toBe(
      fileContent.replace(
        `"~> 4.2", '< 5.5',  ">= 4.2.1"`,
        `"~> 6.0", '< 6.0.1',  ">= 4.2.1"`,
      ),
    );
  });

  it('keeps the layout of a declaration that spans several lines', async () => {
    const fileContent = codeBlock`
      spec.add_dependency 'activesupport',
                          '>= 6.1',
                          '< 8'
    `;
    const upgrade = await getUpgrade(fileContent, 0, '8.0.0', '6.1.0');
    upgrade.newValue = '>= 6.1, < 9';

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(res).toBe(fileContent.replace(`'< 8'`, `'< 9'`));
  });

  it('keeps %q delimiters, arrays and .freeze calls', async () => {
    const fileContent = codeBlock`
      s.add_runtime_dependency(%q<rack>.freeze, [">= 2.2".freeze, "< 3".freeze])
    `;
    const upgrade = await getUpgrade(fileContent, 0, '3.1.0', '2.2.0');
    upgrade.newValue = '>= 2.2, < 4';

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(res).toBe(
      's.add_runtime_dependency(%q<rack>.freeze, [">= 2.2".freeze, "< 4".freeze])',
    );
  });

  it('writes every constraint in the style of the first when their number changes', async () => {
    const fileContent = `spec.add_dependency 'rack', '>= 2.2'.freeze, "< 3"`;
    const upgrade = await getUpgrade(fileContent, 0, '3.1.0', '2.2.0');
    upgrade.newValue = '~> 3.1';

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(res).toBe(`spec.add_dependency 'rack', '~> 3.1'.freeze`);
  });

  it('updates the declaration at fileReplacePosition when the gem is declared twice', async () => {
    const fileContent = codeBlock`
      if RUBY_VERSION >= '4.0'
        spec.add_dependency 'foo', '~> 2.0'
      else
        spec.add_dependency 'foo', '~> 2.0'
      end
    `;
    const upgrade = await getUpgrade(fileContent, 1, '3.0.0', '2.0.0');

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(res).toBe(codeBlock`
      if RUBY_VERSION >= '4.0'
        spec.add_dependency 'foo', '~> 2.0'
      else
        spec.add_dependency 'foo', '~> 3.0'
      end
    `);
  });

  it('replaces the gem name', async () => {
    const fileContent = `spec.add_dependency %q<foo>.freeze, '~> 1.0'`;
    const upgrade = await getUpgrade(fileContent, 0, '2.0.0', '1.0.0');
    upgrade.newName = 'bar';

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade,
    });

    expect(res).toBe(`spec.add_dependency %q<bar>.freeze, '~> 2.0'`);
  });

  it('returns the content unchanged when it is already updated', () => {
    const fileContent = `spec.add_dependency 'rails', '~> 7.1'`;

    const res = updateDependency({
      fileContent,
      packageFile: 'foo.gemspec',
      upgrade: {
        depName: 'rails',
        fileReplacePosition: 20,
        currentValue: '~> 6.0',
        newValue: '~> 7.1',
      },
    });

    expect(res).toBe(fileContent);
  });

  it.each`
    description                                   | fileContent                                  | fileReplacePosition
    ${'no declaration starts at the position'}    | ${`spec.add_dependency 'rails', '~> 6.0'`}   | ${21}
    ${'the position is unset'}                    | ${`spec.add_dependency 'rails', '~> 6.0'`}   | ${undefined}
    ${'the declaration names another gem'}        | ${`spec.add_dependency 'rack', '~> 6.0'`}    | ${20}
    ${'the constraint is no longer a literal'}    | ${`spec.add_dependency 'rails', RAILS`}      | ${20}
    ${'the constraint holds an unexpected value'} | ${`spec.add_dependency 'rails', '~> 6.1.2'`} | ${20}
  `(
    'returns null when $description',
    ({
      fileContent,
      fileReplacePosition,
    }: {
      fileContent: string;
      fileReplacePosition: number | undefined;
    }) => {
      const res = updateDependency({
        fileContent,
        packageFile: 'foo.gemspec',
        upgrade: {
          depName: 'rails',
          fileReplacePosition,
          currentValue: '~> 6.0',
          newValue: '~> 7.1',
        },
      });

      expect(res).toBeNull();
    },
  );
});
