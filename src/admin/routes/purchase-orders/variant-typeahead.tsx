import { Input, Text, Button } from "@medusajs/ui";
import { useEffect, useMemo, useRef, useState } from "react";

export type Variant = {
  id: string;
  sku: string | null;
  title: string;
  product: { title: string } | null;
};

export function variantLabel(v: Variant): string {
  return `${v.product?.title ?? ""} — ${v.title}${v.sku ? ` (${v.sku})` : ""}`;
}

export function VariantTypeahead({
  variants,
  value,
  onChange,
  placeholder = "Search by product, variant, or SKU…",
  maxResults = 10,
  disabled,
}: {
  variants: Variant[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  maxResults?: number;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = variants.find((v) => v.id === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? variants.filter((v) => variantLabel(v).toLowerCase().includes(q))
      : variants;
    return pool.slice(0, maxResults);
  }, [variants, query, maxResults]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (selected) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
        <Text size="small" leading="compact" className="flex-1 break-words">
          {variantLabel(selected)}
        </Text>
        {!disabled && (
          <Button
            variant="transparent"
            size="small"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            type="button"
            aria-label="Clear selection"
          >
            ×
          </Button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout">
          {matches.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onChange(v.id);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left hover:bg-ui-bg-base-hover"
            >
              <Text size="small" leading="compact" className="break-words">
                {variantLabel(v)}
              </Text>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && matches.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 shadow-elevation-flyout">
          <Text size="small" className="text-ui-fg-subtle">
            No matches
          </Text>
        </div>
      )}
    </div>
  );
}
