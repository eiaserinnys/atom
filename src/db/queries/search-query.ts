export class SearchQueryInputError extends Error {
  readonly code = "SEARCH_QUERY_INVALID";
  readonly statusCode = 400;

  constructor() {
    super("Search query contains invalid syntax.");
    this.name = "SearchQueryInputError";
  }
}

interface SearchTerm {
  text: string;
  quoted: boolean;
  excluded: boolean;
}

interface ParsedSearchQuery {
  groups: SearchTerm[][];
  hasDanglingOr: boolean;
}

export interface SearchMatchQueries {
  prefix: string;
  whole: string;
}

function parseSearchQuery(input: string, caseInsensitiveOr: boolean): ParsedSearchQuery {
  const groups: SearchTerm[][] = [[]];
  let hasDanglingOr = false;
  let cursor = 0;

  while (cursor < input.length) {
    while (cursor < input.length && /\s/u.test(input[cursor]!)) cursor++;
    if (cursor >= input.length) break;

    let excluded = false;
    if (input[cursor] === "-" && cursor + 1 < input.length && !/\s/u.test(input[cursor + 1]!)) {
      excluded = true;
      cursor++;
    }

    let quoted = false;
    let text: string;
    if (input[cursor] === '"') {
      quoted = true;
      cursor++;
      let phrase = "";
      while (cursor < input.length) {
        if (input[cursor] === '"') {
          if (input[cursor + 1] === '"') {
            phrase += '"';
            cursor += 2;
            continue;
          }
          cursor++;
          break;
        }
        phrase += input[cursor];
        cursor++;
      }
      text = phrase;
    } else {
      const start = cursor;
      while (cursor < input.length && !/\s/u.test(input[cursor]!)) cursor++;
      text = input.slice(start, cursor);
    }

    if (text.length === 0) continue;
    const isOr = caseInsensitiveOr ? text.toUpperCase() === "OR" : text === "OR";
    if (!excluded && !quoted && isOr) {
      if (groups.at(-1)!.length === 0) hasDanglingOr = true;
      else groups.push([]);
      continue;
    }
    groups.at(-1)!.push({ text, quoted, excluded });
  }

  if (groups.length > 1 && groups.at(-1)!.length === 0) hasDanglingOr = true;
  return { groups: groups.filter(group => group.length > 0), hasDanglingOr };
}

function quoteTsqueryOperand(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export function buildPostgresTsqueryTexts(input: string): SearchMatchQueries {
  const { groups } = parseSearchQuery(input, true);
  const render = (usePrefix: boolean) => groups
    .map(group => group
      .map(term => {
        const operand = quoteTsqueryOperand(term.text);
        if (term.excluded) return `!${operand}`;
        return usePrefix && !term.quoted ? `${operand}:*` : operand;
      })
      .join(" & "))
    .join(" | ");
  return { prefix: render(true), whole: render(false) };
}

export function buildSqliteFtsQueries(input: string): SearchMatchQueries | null {
  const { groups, hasDanglingOr } = parseSearchQuery(input, false);
  if (hasDanglingOr) throw new SearchQueryInputError();

  const render = (usePrefix: boolean) => groups
    .map(group => {
      const positive = group
        .filter(term => !term.excluded)
        .map(term => {
          const phrase = `"${term.text.replace(/"/g, '""')}"`;
          return usePrefix && !term.quoted ? `${phrase}*` : phrase;
        });
      if (positive.length === 0) return null;
      // Apply exclusions within each OR branch so alternatives retain websearch precedence.
      let expression = positive.length === 1 ? positive[0]! : `(${positive.join(" ")})`;
      for (const term of group.filter(term => term.excluded)) {
        expression = `${expression} NOT "${term.text.replace(/"/g, '""')}"`;
      }
      return expression;
    })
    .filter((expression): expression is string => expression !== null);

  const prefix = render(true);
  if (prefix.length === 0) return null;
  const join = (expressions: string[]) => expressions.length === 1
    ? expressions[0]!
    : expressions.map(expression => `(${expression})`).join(" OR ");
  return { prefix: join(prefix), whole: join(render(false)) };
}
