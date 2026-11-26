export const CARD_TITLE_MAX_CHARS = 50;

/** Why `title` cannot be stored, or null when it is a valid card title. */
export function cardTitleProblem(title: unknown): string | null {
  if (typeof title !== "string") {
    return `title is required (a string of 1-${CARD_TITLE_MAX_CHARS} characters)`;
  }
  if (title.trim().length === 0) {
    return "title must not be empty or whitespace only";
  }
  if (title.length > CARD_TITLE_MAX_CHARS) {
    return `title must be at most ${CARD_TITLE_MAX_CHARS} characters (got ${title.length})`;
  }
  return null;
}
