import { Text } from "@medusajs/ui";
import type { TocEntry } from "../toc";

type Props = {
  entries: TocEntry[];
  activeId?: string;
};

export function Toc({ entries, activeId }: Props) {
  if (entries.length === 0) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        No matching sections.
      </Text>
    );
  }

  return (
    <nav aria-label="Operations manual sections">
      <ul className="space-y-1">
        {entries.map((e) => {
          const isActive = activeId === e.id;
          return (
            <li
              key={e.id}
              className={e.level === 3 ? "pl-4" : "pt-2 first:pt-0"}
            >
              <a
                href={`#${e.id}`}
                className={`block py-1 text-sm leading-snug transition ${
                  isActive
                    ? "font-medium text-ui-fg-base"
                    : e.level === 2
                      ? "font-medium text-ui-fg-base hover:text-ui-fg-interactive"
                      : "text-ui-fg-subtle hover:text-ui-fg-base"
                }`}
              >
                {e.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
