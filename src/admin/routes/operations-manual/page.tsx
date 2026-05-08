import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Input, Text } from "@medusajs/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import MANUAL_MD from "./content.md?raw";
import { Content } from "./components/Content";
import { Toc } from "./components/Toc";
import { filterToc, parseToc } from "./toc";

const OperationsManualPage = () => {
  const allEntries = useMemo(() => parseToc(MANUAL_MD), []);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | undefined>(allEntries[0]?.id);
  const contentRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => filterToc(allEntries, search), [allEntries, search]);

  // Track which section is closest to the top of the viewport so the TOC
  // can highlight the active section while the user reads. Plain
  // intersection observer with a generous root margin so the active
  // entry switches a bit before the heading hits the very top.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const headings = Array.from(
      root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"),
    );
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .map((r) => r.target as HTMLElement);
        if (visible.length === 0) return;
        // Pick the topmost visible heading.
        visible.sort(
          (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
        );
        const id = visible[0].id;
        if (id) setActiveId(id);
      },
      {
        rootMargin: "-10% 0px -70% 0px",
        threshold: 0,
      },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  return (
    <Container className="p-0">
      <div className="px-6 py-4 border-b">
        <Heading level="h2">Operations Manual</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Day-to-day procedures for running Strike Arena. Keep this open
          while you work — every section maps to a click path in this
          admin or one of the connected dashboards.
        </Text>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-0 lg:min-h-screen">
        <aside className="border-b lg:border-b-0 lg:border-r border-ui-border-base lg:sticky lg:top-0 lg:h-screen">
          <div className="px-6 py-4 lg:h-full lg:overflow-y-auto">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter sections…"
              className="mb-4"
            />
            <Toc entries={entries} activeId={activeId} />
          </div>
        </aside>
        <div ref={contentRef} className="px-6 py-6 max-w-3xl scroll-smooth">
          <Content markdown={MANUAL_MD} />
        </div>
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Operations Manual",
});

export default OperationsManualPage;
