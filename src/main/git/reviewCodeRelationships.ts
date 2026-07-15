const declarationPatterns = [
  /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:def|class|fn|struct|trait|enum)\s+([A-Za-z_][\w]*)/g
];

const enclosingDeclarationPattern = /\b(?:class|interface|enum|namespace|function)\s+([A-Za-z_$][\w$]*)/g;

type DiffSide = 'old' | 'new';

type SourceLine = {
  changed: boolean;
  text: string;
};

type LexicalState = {
  blockComment: boolean;
  quote?: "'" | '"' | '`';
  escaped: boolean;
};

type DeclarationScope = {
  bodyDepth: number;
  symbol: string;
};

export function extractDeclarations(value: string): string[] {
  const declarations = new Set<string>();

  for (const pattern of declarationPatterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      if (match[1]) {
        declarations.add(match[1]);
      }
    }
  }

  return [...declarations];
}

export function extractEnclosingDeclarationSymbols(bodyLines: string[]): string[] {
  const symbols = new Set<string>();

  collectEnclosingSymbols(toSourceLines(bodyLines, 'old'), symbols);
  collectEnclosingSymbols(toSourceLines(bodyLines, 'new'), symbols);

  return [...symbols];
}

function toSourceLines(bodyLines: string[], side: DiffSide): SourceLine[] {
  return bodyLines.flatMap((line): SourceLine[] => {
    if (line.startsWith('\\')) {
      return [];
    }

    if (line.startsWith(' ')) {
      return [{ changed: false, text: line.slice(1) }];
    }

    if (side === 'old' && line.startsWith('-')) {
      return [{ changed: true, text: line.slice(1) }];
    }

    if (side === 'new' && line.startsWith('+')) {
      return [{ changed: true, text: line.slice(1) }];
    }

    return [];
  });
}

function collectEnclosingSymbols(lines: SourceLine[], symbols: Set<string>): void {
  const lexicalState: LexicalState = { blockComment: false, escaped: false };
  const scopes: DeclarationScope[] = [];
  let depth = 0;

  for (const line of lines) {
    const code = maskNonCode(line.text, lexicalState);
    removeClosedScopes(scopes, depth);

    if (line.changed) {
      for (const scope of scopes) {
        symbols.add(scope.symbol);
      }
    }

    const openings = braceOpenings(code);
    enclosingDeclarationPattern.lastIndex = 0;

    for (const match of code.matchAll(enclosingDeclarationPattern)) {
      const opening = openings.find((index) => index >= (match.index ?? 0) + match[0].length);

      if (match[1] && opening !== undefined) {
        const bodyDepth = depth + braceDelta(code.slice(0, opening + 1));
        scopes.push({ bodyDepth, symbol: match[1] });
      }
    }

    depth += braceDelta(code);
    removeClosedScopes(scopes, depth);
  }
}

function removeClosedScopes(scopes: DeclarationScope[], depth: number): void {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (depth < scopes[index]!.bodyDepth) {
      scopes.splice(index, 1);
    }
  }
}

function braceOpenings(value: string): number[] {
  const openings: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '{') {
      openings.push(index);
    }
  }

  return openings;
}

function braceDelta(value: string): number {
  let depth = 0;

  for (const character of value) {
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
  }

  return depth;
}

function maskNonCode(value: string, state: LexicalState): string {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const nextCharacter = value[index + 1];

    if (state.blockComment) {
      if (character === '*' && nextCharacter === '/') {
        result += '  ';
        state.blockComment = false;
        index += 1;
      } else {
        result += ' ';
      }
      continue;
    }

    if (state.quote) {
      result += ' ';

      if (state.escaped) {
        state.escaped = false;
      } else if (character === '\\') {
        state.escaped = true;
      } else if (character === state.quote) {
        state.quote = undefined;
      }
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      return result.padEnd(value.length, ' ');
    }

    if (character === '/' && nextCharacter === '*') {
      result += '  ';
      state.blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      result += ' ';
      state.quote = character;
      state.escaped = false;
      continue;
    }

    result += character;
  }

  return result;
}
