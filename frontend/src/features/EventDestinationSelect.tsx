import type { ExperienceEvent } from "../types";

type EventDestinationSelectProps = {
  ariaLabel: string;
  editorEvents: ExperienceEvent[];
  emptyLabel?: string;
  onChange: (value: string) => void;
  value: string;
};

export function EventDestinationSelect({
  ariaLabel,
  editorEvents,
  emptyLabel = "Choose event",
  onChange,
  value,
}: EventDestinationSelectProps) {
  const hasEventOption = editorEvents.some((event) => event.slug === value);

  return (
    <select
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      <option value="">{emptyLabel}</option>
      {value && !hasEventOption ? <option value={value}>{value}</option> : null}
      {editorEvents.map((event) => (
        <option key={event.id} value={event.slug}>
          {event.title || event.slug}
          {event.isStart ? " (start)" : ""}
        </option>
      ))}
    </select>
  );
}
