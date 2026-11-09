import { newlineRegex, regEx } from '../../../util/regex.ts';
import type { GemspecDeclaration, GemspecString } from './types.ts';

const declarationHeadRegex = regEx(
  /^[ \t]*[\w:.]+\.add_(?<type>runtime_|development_)?dependency\b/,
);

const percentLiteralRegex = regEx(/^%(?<kind>[qQ]?)(?<open>[^\w\s])/);

const freezeRegex = regEx(/^\.freeze\b/);

const lineBreaks = new Set(['\n', '\r']);

const statementEnds = new Set([undefined, '\n', '\r', '#', ';']);

const closingDelimiters: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>',
};

class Scanner {
  private readonly content: string;
  pos: number;

  constructor(content: string, pos: number) {
    this.content = content;
    this.pos = pos;
  }

  peek(): string | undefined {
    return this.content[this.pos];
  }

  /** Skips spaces and tabs, and also line breaks and comments when `multiline` is set. */
  skipSpace(multiline: boolean): void {
    while (this.pos < this.content.length) {
      const char = this.content[this.pos];
      if (char === ' ' || char === '\t') {
        this.pos += 1;
      } else if (multiline && lineBreaks.has(char)) {
        this.pos += 1;
      } else if (multiline && char === '#') {
        const lineEnd = this.content.indexOf('\n', this.pos);
        this.pos = lineEnd === -1 ? this.content.length : lineEnd;
      } else {
        return;
      }
    }
  }

  /** Reads a quoted or `%q`/`%Q` string literal, with an optional `.freeze` call. */
  readString(): GemspecString | null {
    const tokenStart = this.pos;
    const quote = this.peek();
    let open: string;
    let interpolates: boolean;
    if (quote === '"' || quote === "'") {
      open = quote;
      interpolates = open === '"';
      this.pos += 1;
    } else {
      const percent = percentLiteralRegex.exec(this.content.slice(this.pos));
      if (!percent?.groups) {
        return null;
      }
      open = percent.groups.open;
      interpolates = percent.groups.kind !== 'q';
      this.pos += percent[0].length;
    }
    const close = closingDelimiters[open] ?? open;
    const valueStart = this.pos;
    let dynamic = false;
    let depth = 0;
    while (this.pos < this.content.length) {
      const char = this.peek();
      if (char === close && depth === 0) {
        break;
      }
      if (close !== open && char === open) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
      } else if (char === '\\') {
        dynamic = true;
        this.pos += 1;
      } else if (
        interpolates &&
        char === '#' &&
        this.content[this.pos + 1] === '{'
      ) {
        dynamic = true;
      } else if (char === '\n') {
        return null;
      }
      this.pos += 1;
    }
    if (this.pos >= this.content.length) {
      return null;
    }
    const valueEnd = this.pos;
    this.pos += 1;
    const freeze = freezeRegex.exec(this.content.slice(this.pos));
    if (freeze) {
      this.pos += freeze[0].length;
    }
    return {
      value: this.content.slice(valueStart, valueEnd),
      valueStart,
      valueEnd,
      tokenStart,
      tokenEnd: this.pos,
      dynamic,
    };
  }
}

/**
 * Reads the arguments of one `add_*dependency` call, starting just after the method name.
 * Returns `null` when the gem name is not a string literal.
 */
function parseArguments(
  scanner: Scanner,
): Omit<GemspecDeclaration, 'depType'> | null {
  scanner.skipSpace(false);
  let inParens = false;
  if (scanner.peek() === '(') {
    inParens = true;
    scanner.pos += 1;
    scanner.skipSpace(true);
  }
  const name = scanner.readString();
  if (!name) {
    return null;
  }

  const requirements: GemspecString[] = [];
  let inArray = false;
  let usedArray = false;
  for (;;) {
    scanner.skipSpace(inParens || inArray);
    if (scanner.peek() === ',') {
      if (usedArray && !inArray) {
        // requirements mixing an array with further strings
        return { name, requirements: null };
      }
      scanner.pos += 1;
      scanner.skipSpace(true);
      const closesArray = inArray && scanner.peek() === ']';
      const closesCall = inParens && scanner.peek() === ')';
      if (closesArray || closesCall) {
        // trailing comma
        continue;
      }
      if (scanner.peek() === '[' && !requirements.length) {
        inArray = true;
        usedArray = true;
        scanner.pos += 1;
        scanner.skipSpace(true);
      }
      const requirement = scanner.readString();
      if (!requirement) {
        return { name, requirements: null };
      }
      requirements.push(requirement);
    } else if (inArray && scanner.peek() === ']') {
      inArray = false;
      scanner.pos += 1;
    } else if (inParens && scanner.peek() === ')') {
      inParens = false;
      scanner.pos += 1;
    } else {
      break;
    }
  }

  const statementEnded =
    !inParens && !inArray && statementEnds.has(scanner.peek());
  if (
    !statementEnded ||
    !requirements.length ||
    requirements.some(({ dynamic }) => dynamic)
  ) {
    return { name, requirements: null };
  }
  return { name, requirements };
}

/**
 * Statically finds the `add_dependency`, `add_runtime_dependency` and `add_development_dependency` calls in a gemspec.
 * A call may span several lines, and may follow another statement after a `;`.
 */
export function parseGemspec(content: string): GemspecDeclaration[] {
  const declarations: GemspecDeclaration[] = [];
  let lineStart = 0;
  while (lineStart < content.length) {
    let statementStart = lineStart;
    let nextLine = content.indexOf('\n', lineStart);
    nextLine = nextLine === -1 ? content.length : nextLine + 1;
    for (;;) {
      const head = declarationHeadRegex.exec(
        content.slice(statementStart, nextLine).split(newlineRegex)[0],
      );
      if (!head) {
        break;
      }
      const scanner = new Scanner(content, statementStart + head[0].length);
      const args = parseArguments(scanner);
      if (!args) {
        break;
      }
      declarations.push({
        ...args,
        depType:
          head.groups?.type === 'development_' ? 'development' : 'runtime',
      });
      if (scanner.pos > nextLine - 1) {
        const lineEnd = content.indexOf('\n', scanner.pos);
        nextLine = lineEnd === -1 ? content.length : lineEnd + 1;
      }
      if (args.requirements === null || scanner.peek() !== ';') {
        break;
      }
      statementStart = scanner.pos + 1;
    }
    lineStart = nextLine;
  }
  return declarations;
}

/** The requirements as a single comma-separated value for the `ruby` versioning. */
export function getRequirementValue(requirements: GemspecString[]): string {
  return requirements.map(({ value }) => value.trim()).join(', ');
}
