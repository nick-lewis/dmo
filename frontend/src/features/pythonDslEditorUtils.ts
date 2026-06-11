const defaultIndent = "    ";

export type DslSourceRange = { from: number; to: number };

const scriptActionSourcePattern = /\bscript\s*\([^)]*\)/g;

export function scriptActionRangesFromSource(source: string): DslSourceRange[] {
  const ranges: DslSourceRange[] = [];
  let offset = 0;

  for (const line of source.split("\n")) {
    if (!line.trimStart().startsWith("#")) {
      for (const match of line.matchAll(scriptActionSourcePattern)) {
        if (typeof match.index !== "number") continue;
        ranges.push({
          from: offset + match.index,
          to: offset + match.index + match[0].length,
        });
      }
    }
    offset += line.length + 1;
  }

  return ranges;
}

// Maps each pre-change script action through the document change and reports
// the indices whose text no longer lands on a script action. Ranges must be
// in document order; mapPosition is the change-set position mapper.
export function removedScriptActionIndices(
  oldRanges: DslSourceRange[],
  newRanges: DslSourceRange[],
  mapPosition: (position: number, assoc: -1 | 1) => number,
): number[] {
  const removed: number[] = [];
  let nextNewIndex = 0;

  oldRanges.forEach((range, index) => {
    const mappedFrom = mapPosition(range.from, 1);
    const mappedTo = mapPosition(range.to, -1);
    let claimed = false;

    while (nextNewIndex < newRanges.length) {
      const candidate = newRanges[nextNewIndex];
      if (candidate.to <= mappedFrom) {
        nextNewIndex += 1;
        continue;
      }
      if (candidate.from < mappedTo && candidate.to > mappedFrom) {
        claimed = true;
        nextNewIndex += 1;
      }
      break;
    }

    if (!claimed) removed.push(index);
  });

  return removed;
}

export type PythonDslButtonStringArgument = {
  from: number;
  to: number;
  value: string;
  valueFrom: number;
  valueTo: number;
};

export type PythonDslButtonBooleanArgument = {
  from: number;
  to: number;
  value: boolean;
  valueFrom: number;
  valueTo: number;
};

function isBlockStarter(line: string) {
  return /:\s*(#.*)?$/.test(line) && !line.trimStart().startsWith("#");
}

function isDedentStarter(line: string) {
  return /^(elif|else|except|finally)\b/.test(line);
}

export function formatPythonDsl(source: string, indent = defaultIndent) {
  const normalized = source.replace(/\t/g, indent).replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const formatted: string[] = [];
  let depth = 0;
  let blankCount = 0;

  for (const rawLine of lines) {
    const trimmedRight = rawLine.replace(/[ \t]+$/g, "");
    const trimmed = trimmedRight.trimStart();

    if (!trimmed) {
      blankCount += 1;
      if (blankCount <= 1 && formatted.length) {
        formatted.push("");
      }
      continue;
    }

    blankCount = 0;
    if (isDedentStarter(trimmed)) {
      depth = Math.max(0, depth - 1);
    }

    formatted.push(`${indent.repeat(depth)}${trimmed}`);

    if (isBlockStarter(trimmed)) {
      depth += 1;
    }
  }

  return formatted.join("\n").trimEnd();
}

export function parseDestinationArgumentRange(
  source: string,
  actionFrom: number,
  allowPositional = true,
): PythonDslButtonStringArgument | undefined {
  const destinationMatch =
    /\b(?:destination|target|triggersEvent)\s*=\s*(["'])(.*?)\1/.exec(source);
  if (destinationMatch) {
    const quoteIndex = destinationMatch[0].indexOf(destinationMatch[1]);
    const value = destinationMatch[2];
    const valueFrom = actionFrom + destinationMatch.index + quoteIndex + 1;
    return {
      from: actionFrom + destinationMatch.index,
      to: actionFrom + destinationMatch.index + destinationMatch[0].length,
      value,
      valueFrom,
      valueTo: valueFrom + value.length,
    };
  }

  if (!allowPositional) return undefined;

  const positionalDestinationMatch = /\(\s*(["'])(.*?)\1/.exec(source);
  if (!positionalDestinationMatch) return undefined;

  const quoteIndex = positionalDestinationMatch[0].indexOf(
    positionalDestinationMatch[1],
  );
  const value = positionalDestinationMatch[2];
  const valueFrom =
    actionFrom + positionalDestinationMatch.index + quoteIndex + 1;
  return {
    from: actionFrom + positionalDestinationMatch.index,
    to:
      actionFrom +
      positionalDestinationMatch.index +
      positionalDestinationMatch[0].length,
    value,
    valueFrom,
    valueTo: valueFrom + value.length,
  };
}

export function parseButtonActionArgumentRanges(
  source: string,
  actionFrom: number,
) {
  const destination = parseDestinationArgumentRange(source, actionFrom, false);

  const iconMatch = /\bicon\s*=\s*(True|False|true|false)\b/.exec(source);
  const icon = iconMatch
    ? (() => {
        const rawValue = iconMatch[1];
        const valueOffset = iconMatch[0].lastIndexOf(rawValue);
        const valueFrom = actionFrom + iconMatch.index + valueOffset;
        return {
          from: actionFrom + iconMatch.index,
          to: actionFrom + iconMatch.index + iconMatch[0].length,
          value: rawValue.toLowerCase() === "true",
          valueFrom,
          valueTo: valueFrom + rawValue.length,
        };
      })()
    : undefined;

  return { destination, icon };
}

export function lineStartOffset(lines: string[], lineIndex: number) {
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

export function leadingWhitespaceLength(line: string) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export function lineStartsIndentedBlock(lines: string[], lineIndex: number) {
  const line = lines[lineIndex] ?? "";
  const trimmed = line.trim();
  if (!trimmed.endsWith(":")) return false;

  const indentation = leadingWhitespaceLength(line);
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const nextLine = lines[index] ?? "";
    if (!nextLine.trim()) continue;
    return leadingWhitespaceLength(nextLine) > indentation;
  }

  return false;
}

export function canSwapDslActionLine(
  lines: string[],
  currentIndex: number,
  nextIndex: number,
  direction: -1 | 1,
) {
  const currentLine = lines[currentIndex] ?? "";
  const nextLine = lines[nextIndex] ?? "";
  if (!nextLine.trim()) return true;
  if (leadingWhitespaceLength(nextLine) !== leadingWhitespaceLength(currentLine)) {
    return false;
  }
  return direction === -1 || !lineStartsIndentedBlock(lines, nextIndex);
}
