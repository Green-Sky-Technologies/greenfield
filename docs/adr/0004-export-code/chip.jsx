<Chip />

import "./chip.css";

export interface ChipProps {
  selected?: "On" | "Off";
}

export function Chip({
  selected = "On",
}: ChipProps) {
  return (
    <div className="chip" data-selected={selected}>
      <p className="label">All trails</p>
    </div>
  );
}

/* chip.css */
:root {
  --color-brand: #0E7C66;
  --color-onbrand: #FFFFFF;
}
.chip {
  position: relative;
  display: flex;
  flex-direction: row;
  gap: 6px;
  padding: 8px 16px 8px 16px;
  justify-content: flex-start;
  align-items: center;
  border-radius: 999px;
  background: var(--color-brand, #0E7C66);
}
.label {
  color: var(--color-onbrand, #FFFFFF);
  font-family: "Inter";
  font-size: 13px;
  font-weight: 500;
  line-height: 140%;
}
.chip[data-selected="Off"] {
  background: var(--color-surface, #FFFFFF);
  border: 1px solid var(--color-border, #E3E8EF);
}
.chip[data-selected="Off"] .label {
  color: var(--color-text, #0F172A);
}
