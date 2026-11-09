/** A Ruby string literal in the gemspec source. */
export interface GemspecString {
  /** The literal's text between its delimiters. */
  value: string;
  /** Offset of the first character of `value`. */
  valueStart: number;
  /** Offset just past the last character of `value`. */
  valueEnd: number;
  /** Offset of the opening delimiter, e.g. `"` or `%q<`. */
  tokenStart: number;
  /** Offset just past the closing delimiter and any `.freeze` call. */
  tokenEnd: number;
  /** Whether Ruby would evaluate part of `value`, through interpolation or escapes. */
  dynamic: boolean;
}

export interface GemspecDeclaration {
  name: GemspecString;
  depType: 'runtime' | 'development';
  /** The version requirements, or `null` when they are absent or not all string literals. */
  requirements: GemspecString[] | null;
}

export interface GemspecLockFile {
  lockFile: string;
  lockFileContent: string;
}
