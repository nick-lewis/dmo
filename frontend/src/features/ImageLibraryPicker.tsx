import { publicAsset } from "../assets";
import { TrashIcon } from "../components/Icons";

export type ImageLibraryOption = {
  label: string;
  path: string;
  removable?: boolean;
  source: string;
};

type ImageLibraryPickerClassNames = {
  deleteButton: string;
  empty: string;
  option: string;
  optionMain: string;
  picker: string;
};

export function ImageLibraryPicker({
  ariaLabel,
  classNames,
  deletingPath,
  emptyLabel,
  isLoading,
  loadingLabel = "Loading images",
  onDelete,
  onSelect,
  options,
  selectedPath,
}: {
  ariaLabel: string;
  classNames: ImageLibraryPickerClassNames;
  deletingPath: string;
  emptyLabel: string;
  isLoading: boolean;
  loadingLabel?: string;
  onDelete: (path: string, label: string) => void;
  onSelect: (path: string) => void;
  options: ImageLibraryOption[];
  selectedPath: string;
}) {
  return (
    <div aria-label={ariaLabel} className={classNames.picker}>
      {isLoading ? (
        <div className={classNames.empty}>{loadingLabel}</div>
      ) : options.length ? (
        options.map((option) => {
          const isSelected = option.path === selectedPath;
          return (
            <div className={classNames.option} key={option.path}>
              <button
                aria-pressed={isSelected}
                className={classNames.optionMain}
                onClick={() => onSelect(option.path)}
                type="button"
              >
                <img alt="" src={publicAsset(option.path)} />
                <span>{option.label}</span>
                <small>{option.source}</small>
              </button>
              {option.removable ? (
                <button
                  aria-label={`Delete ${option.label}`}
                  className={classNames.deleteButton}
                  disabled={deletingPath === option.path}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(option.path, option.label);
                  }}
                  title="Delete uploaded image"
                  type="button"
                >
                  <TrashIcon />
                </button>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className={classNames.empty}>{emptyLabel}</div>
      )}
    </div>
  );
}
