// Flat pagination pill floating over the main panel for moving between
// slides. Deliberately quiet: no border, shadow, or glass, and dimmed until
// hovered, so it reads as part of the slide area rather than a control.
// The caller owns which slides exist and which one is showing; in the real
// player that is the session's revealed-slide history.

type SlidePagerProps = {
  activeIndex: number;
  count: number;
  disabled?: boolean;
  onSelect: (index: number) => void;
};

export function SlidePager({
  activeIndex,
  count,
  disabled = false,
  onSelect,
}: SlidePagerProps) {
  if (count < 2) return null;

  return (
    <nav aria-label="Slides shown so far" className="slide-pager">
      <button
        aria-label="Previous slide"
        className="slide-pager-arrow"
        disabled={disabled || activeIndex <= 0}
        onClick={() => onSelect(activeIndex - 1)}
        type="button"
      >
        ‹
      </button>
      <div className="slide-pager-dots">
        {Array.from({ length: count }, (_, index) => (
          <button
            aria-current={index === activeIndex}
            aria-label={`Slide ${index + 1}`}
            className={`slide-pager-dot${
              index === activeIndex ? " is-active" : ""
            }`}
            disabled={disabled}
            key={index}
            onClick={() => onSelect(index)}
            type="button"
          />
        ))}
      </div>
      <button
        aria-label="Next slide"
        className="slide-pager-arrow"
        disabled={disabled || activeIndex >= count - 1}
        onClick={() => onSelect(activeIndex + 1)}
        type="button"
      >
        ›
      </button>
    </nav>
  );
}
