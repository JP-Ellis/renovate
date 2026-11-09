import { logger } from '../../../logger/index.ts';
import type { UpdateDependencyConfig } from '../types.ts';
import { getRequirementValue, parseGemspec } from './parse.ts';
import type { GemspecString } from './types.ts';

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Rewrites the requirement literals in place, keeping each one's delimiters, `.freeze` call and layout. */
function getRequirementEdits(
  fileContent: string,
  requirements: GemspecString[],
  newValue: string,
): Edit[] {
  const newParts = newValue.split(',').map((part) => part.trim());
  if (newParts.length === requirements.length) {
    return requirements
      .map((requirement, index) => ({ requirement, newPart: newParts[index] }))
      .filter(
        ({ requirement, newPart }) => requirement.value.trim() !== newPart,
      )
      .map(({ requirement, newPart }) => ({
        start: requirement.valueStart,
        end: requirement.valueEnd,
        text: newPart,
      }));
  }

  // The number of requirements changed, so write them all in the style of the first
  const [first] = requirements;
  const prefix = fileContent.slice(first.tokenStart, first.valueStart);
  const suffix = fileContent.slice(first.valueEnd, first.tokenEnd);
  return [
    {
      start: first.tokenStart,
      end: requirements.at(-1)!.tokenEnd,
      text: newParts.map((part) => `${prefix}${part}${suffix}`).join(', '),
    },
  ];
}

export function updateDependency({
  fileContent,
  upgrade,
}: UpdateDependencyConfig): string | null {
  const { depName, fileReplacePosition, currentValue, newValue, newName } =
    upgrade;
  const declaration = parseGemspec(fileContent).find(
    ({ name }) => name.tokenStart === fileReplacePosition,
  );
  if (!declaration?.requirements || declaration.name.value !== depName) {
    logger.debug(
      { depName, fileReplacePosition },
      'gemspec: dependency declaration not found',
    );
    return null;
  }

  const edits: Edit[] = [];
  const foundValue = getRequirementValue(declaration.requirements);
  if (newValue && foundValue !== newValue) {
    if (foundValue !== currentValue) {
      logger.debug(
        { depName, foundValue, currentValue, newValue },
        'gemspec: unexpected requirement value',
      );
      return null;
    }
    edits.push(
      ...getRequirementEdits(fileContent, declaration.requirements, newValue),
    );
  }
  if (newName && newName !== declaration.name.value) {
    edits.push({
      start: declaration.name.valueStart,
      end: declaration.name.valueEnd,
      text: newName,
    });
  }

  let newContent = fileContent;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    newContent = newContent.slice(0, start) + text + newContent.slice(end);
  }
  return newContent;
}
