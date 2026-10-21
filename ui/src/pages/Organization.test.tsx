// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Project } from "@paperclipai/shared";
import { Organization } from "./Organization";

const projectsApi = vi.hoisted(() => ({ list: vi.fn() }));
const agentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const setBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { name: "IPD 开发部" } }),
}));
vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs }),
}));
vi.mock("../api/projects", () => ({ projectsApi }));
vi.mock("../api/agents", () => ({ agentsApi }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

const project = (id: string, name: string, parentProjectId: string | null, leadAgentId: string): Project => ({
  id, companyId: "company-1", name, goalId: null, goalIds: [], goals: [],
  parentProjectId, status: "planned", leadAgentId, archivedAt: null,
} as unknown as Project);

const agent = (id: string, name: string, reportsTo: string | null, title: string): Agent => ({
  id, companyId: "company-1", name, title, role: "general", status: "idle", reportsTo,
} as unknown as Agent);

describe("Organization", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    projectsApi.list.mockResolvedValue([
      project("p0", "Robot System · 整机产品", null, "pm0"),
      project("p1", "Robot Brain · 大脑与认知", "p0", "pm1"),
      project("p2", "Robot Perception · 感知与融合", "p1", "pm2"),
    ]);
    agentsApi.list.mockResolvedValue([
      agent("pm0", "项目经理 · robot-product-pm", null, "项目经理"),
      agent("pm1", "项目经理 · robot-brain-pm", "pm0", "项目经理"),
      agent("re1", "需求分析师 · robot-brain-re", "pm1", "需求分析师"),
      agent("pm2", "项目经理 · perception-pm", "pm1", "项目经理"),
    ]);
  });

  afterEach(async () => {
    if (root) await act(() => root!.unmount());
    container.remove();
    queryClient.clear();
  });

  it("renders the company -> project -> team -> agents tree", async () => {
    root = createRoot(container);
    await act(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Organization />
        </QueryClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 20 && !container.textContent?.includes("Robot Brain"); attempt += 1) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    const text = container.textContent ?? "";
    expect(text).toContain("IPD 开发部");
    expect(text).toContain("Robot System · 整机产品");
    expect(text).toContain("Robot Brain · 大脑与认知");
    expect(text).toContain("Robot Perception · 感知与融合");
    expect(text).toContain("项目经理 · robot-brain-pm");
    expect(text).toContain("需求分析师");
    expect(text).toContain("Team");
    expect(setBreadcrumbs).toHaveBeenCalled();
  });
});
