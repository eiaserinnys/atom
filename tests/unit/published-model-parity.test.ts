import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// The standalone page published/atom-search-motion/index.html inlines its own copy of the
// Jev event reducer. The dashboard uses dashboard/src/components/SearchMotionView/model.js.
// Both must turn the same recorded event stream into the same model, so the published
// page and the dashboard keep showing the same search. Only reducer output is compared
// (not source text), so a generated page or a shared module still passes.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const html = read("../../published/atom-search-motion/index.html");
const dashboardModel = read("../../dashboard/src/components/SearchMotionView/model.js");
const samples = JSON.parse(read("../../dashboard/src/components/SearchMotionView/fixtures/samples.json")) as Record<string, any[]>;

interface Reducer { createModel(): any; applyEvent(model: any, event: any): any }
const EXPORTS = "\n({ createModel, applyEvent, eventsFromResponse })";

function fromPublishedPage(): Reducer {
  const start = html.indexOf("  function createModel()");
  const end = html.indexOf("  const eventTime");
  if (start < 0 || end < start) throw new Error("reducer markers missing in the published page");
  return runInNewContext(html.slice(start, end) + EXPORTS, { ROOT: "__root__" }, { timeout: 1000 });
}

function fromDashboard(): Reducer {
  const source = dashboardModel.replace(/^export \{[^}]*\};?\s*$/m, "");
  return runInNewContext(source + EXPORTS, {}, { timeout: 1000 });
}

// Maps and Sets become arrays; `dormant` exists only in the dashboard reducer's node shape.
function plain(model: unknown): unknown {
  return JSON.parse(JSON.stringify(model, (key, value) => {
    if (key === "dormant") return undefined;
    if (value instanceof Map) return { __map: [...value.entries()] };
    if (value instanceof Set) return { __set: [...value] };
    return value;
  }));
}

describe("published page reducer matches the dashboard reducer", () => {
  it.each(Object.keys(samples))("sample %s ends in the same model after every event", (name) => {
    const published = fromPublishedPage();
    const dashboard = fromDashboard();
    const a = published.createModel();
    const b = dashboard.createModel();
    expect(plain(a)).toEqual(plain(b));
    samples[name].forEach((event, index) => {
      const deltaA = published.applyEvent(a, event);
      const deltaB = dashboard.applyEvent(b, event);
      expect([name, index, plain(deltaA)]).toEqual([name, index, plain(deltaB)]);
      expect([name, index, plain(a)]).toEqual([name, index, plain(b)]);
    });
    const done = samples[name].at(-1)!.data as { results: unknown[] };
    expect([...a.nodes.values()].filter((n: { selected: boolean }) => n.selected)).toHaveLength(done.results.length);
  });
});
