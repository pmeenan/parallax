import type { WorldStreamingService } from "@parallax/engine";
import {
  createStreamingDashboardModel,
  type StreamingDashboardMetric,
  type StreamingDashboardModel,
} from "@parallax/game";

interface StreamingDashboardDom {
  readonly announcement: HTMLParagraphElement;
  readonly metrics: ReadonlyMap<string, HTMLElement>;
  readonly observerTargets: HTMLUListElement;
  readonly panel: HTMLElement;
  readonly residentCellIds: HTMLUListElement;
}

export function mountStreamingDashboard(
  panel: HTMLElement,
  streamingService: Pick<WorldStreamingService, "snapshot" | "subscribe">,
): () => void {
  const initialModel = createStreamingDashboardModel(streamingService.snapshot());
  const dom = createDashboardDom(panel, initialModel);
  return streamingService.subscribe((snapshot) => {
    renderDashboard(dom, createStreamingDashboardModel(snapshot));
  });
}

function createDashboardDom(
  panel: HTMLElement,
  initialModel: StreamingDashboardModel,
): StreamingDashboardDom {
  const title = document.createElement("h2");
  title.id = "streaming-dashboard-title";
  title.textContent = initialModel.title;
  panel.setAttribute("aria-labelledby", title.id);

  const announcement = document.createElement("p");
  announcement.className = "streaming-dashboard-summary";
  announcement.setAttribute("aria-atomic", "true");
  announcement.setAttribute("aria-live", "polite");

  const grid = document.createElement("div");
  grid.className = "streaming-dashboard-grid";
  const metrics = new Map<string, HTMLElement>();
  for (const section of initialModel.sections) {
    const sectionElement = document.createElement("section");
    const sectionTitle = document.createElement("h3");
    sectionTitle.textContent = section.title;
    const list = document.createElement("dl");
    for (const metric of section.metrics) {
      const term = document.createElement("dt");
      term.textContent = metric.label;
      const description = document.createElement("dd");
      description.dataset.metric = metric.id;
      list.append(term, description);
      metrics.set(metric.id, description);
    }
    sectionElement.append(sectionTitle, list);
    grid.append(sectionElement);
  }

  const details = document.createElement("details");
  details.className = "streaming-dashboard-details";
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = "Resident and observer identities";
  const residentHeading = document.createElement("h3");
  residentHeading.textContent = "Resident cell IDs";
  const residentCellIds = document.createElement("ul");
  const observerHeading = document.createElement("h3");
  observerHeading.textContent = "Observer targets";
  const observerTargets = document.createElement("ul");
  details.append(
    detailsSummary,
    residentHeading,
    residentCellIds,
    observerHeading,
    observerTargets,
  );

  panel.replaceChildren(title, announcement, grid, details);
  return Object.freeze({
    announcement,
    metrics,
    observerTargets,
    panel,
    residentCellIds,
  });
}

function renderDashboard(dom: StreamingDashboardDom, model: StreamingDashboardModel): void {
  dom.panel.dataset.state = model.state;
  dom.panel.dataset.streamingSchema = model.schemaVersion.toString();
  setText(dom.announcement, model.announcement);
  for (const section of model.sections) {
    for (const metric of section.metrics) {
      const target = dom.metrics.get(metric.id);
      if (target === undefined) {
        throw new Error(`Streaming dashboard metric ${metric.id} has no mounted output`);
      }
      renderMetric(target, metric);
    }
  }
  renderList(dom.residentCellIds, model.residentCellIds, "No resident cells reported.");
  renderList(dom.observerTargets, model.observerTargets, "No observer targets reported.");
}

function renderMetric(target: HTMLElement, metric: StreamingDashboardMetric): void {
  target.dataset.state = metric.state;
  setText(target, metric.detail === null ? metric.value : `${metric.value} — ${metric.detail}`);
}

function renderList(target: HTMLUListElement, values: readonly string[], empty: string): void {
  const normalized = values.length === 0 ? [empty] : values;
  const current = Array.from(target.children, (child) => child.textContent ?? "");
  if (
    current.length === normalized.length &&
    current.every((value, index) => value === normalized[index])
  ) {
    return;
  }
  target.replaceChildren(
    ...normalized.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }),
  );
}

function setText(target: Node, value: string): void {
  if (target.textContent !== value) target.textContent = value;
}
