"use client";

import { useLanePromise } from "@lane/lane";
import type { Label } from "@lane/todo-api";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Suspense,
  startTransition,
  use,
  useActionState,
  useId,
  useMemo,
  useOptimistic,
  useState,
} from "react";
import { fetchLabels, labelLane, labelsKey, postLabel } from "./todo-label-data";

type CreateLabelState = {
  error: string | null;
};

export type ChangeTaskLabelsMutation =
  | {
      type: "assign";
      labelId: string;
    }
  | {
      type: "remove";
      labelId: string;
    };

export type ChangeTaskLabelsAction = (
  mutation: ChangeTaskLabelsMutation,
) => Promise<void>;

type OptimisticLabelMutation =
  | {
      type: "assign";
      label: Label;
    }
  | {
      type: "remove";
      labelId: string;
    };

type VisibleLabel = Label & {
  isOptimistic?: boolean;
};

export function TodoLabelCombobox({
  assignedLabels,
  changeTaskLabelsAction,
}: {
  assignedLabels: Label[];
  changeTaskLabelsAction: ChangeTaskLabelsAction;
}) {
  const comboboxId = useId();
  const [optimisticLabels, addOptimisticLabelMutation] = useOptimistic(
    assignedLabels,
    reduceOptimisticLabels,
  );
  const [optimisticCreatedLabels, addOptimisticCreatedLabel] = useOptimistic(
    [] as Label[],
    mergeLabel,
  );
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const labelsPromise = useLanePromise(labelLane, labelsKey, fetchLabels);
  const [createLabelState, dispatchCreateLabelAction] = useActionState(
      async (
        _previousState: CreateLabelState,
        formData: FormData,
      ): Promise<CreateLabelState> => {
        const name = readLabelName(formData);

        if (!name) {
          return {
            error: "Label name is required",
          };
        }

        try {
          await postLabel(name);

          startTransition(() => {
            labelLane.refresh(labelsKey, fetchLabels);
          });

          return {
            error: null,
          };
        } catch (error) {
          return {
            error: getErrorMessage(error),
          };
        }
      },
      {
        error: null,
      },
    );
  const assignedLabelIds = useMemo(
    () => new Set(optimisticLabels.map((label) => label.id)),
    [optimisticLabels],
  );
  const trimmedQuery = query.trim();

  function assignLabel(label: Label) {
    if (assignedLabelIds.has(label.id)) {
      return;
    }

    startTransition(async () => {
      addOptimisticLabelMutation({
        label,
        type: "assign",
      });

      await changeTaskLabelsAction({
        labelId: label.id,
        type: "assign",
      });
    });
  }

  function dispatchCreateLabel(name: string) {
    const formData = new FormData();
    const optimisticLabel: Label = {
      createdAt: new Date().toISOString(),
      id: `optimistic-label-${crypto.randomUUID()}`,
      name,
    };

    formData.set("name", name);
    setQuery("");

    startTransition(() => {
      addOptimisticCreatedLabel(optimisticLabel);
      dispatchCreateLabelAction(formData);
    });
  }

  async function submitQuery() {
    if (!trimmedQuery) {
      return;
    }

    const labels = await labelsPromise;
    const filteredLabels = filterLabels(labels, trimmedQuery);
    const nextLabel = filteredLabels.find(
      (label) => !assignedLabelIds.has(label.id),
    );

    if (nextLabel) {
      assignLabel(nextLabel);
      return;
    }

    if (
      canCreateLabel(
        labels,
        [...optimisticLabels, ...optimisticCreatedLabels],
        trimmedQuery,
      )
    ) {
      dispatchCreateLabel(trimmedQuery);
    }
  }

  function removeLabel(label: Label) {
    startTransition(async () => {
      addOptimisticLabelMutation({
        labelId: label.id,
        type: "remove",
      });

      await changeTaskLabelsAction({
        labelId: label.id,
        type: "remove",
      });
    });
  }

  function openOptions() {
    setIsOpen(true);
  }

  return (
    <section className="label-field">
      <div className="label-field-header">
        <label htmlFor={`${comboboxId}-input`}>Labels</label>
        <button
          aria-expanded={isOpen}
          aria-label="Open labels"
          className="icon-button"
          type="button"
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
            } else {
              openOptions();
            }
          }}
        >
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </div>

      <LabelControls
        comboboxId={comboboxId}
        isOpen={isOpen}
        labels={optimisticLabels}
        query={query}
        removeLabel={removeLabel}
        openOptions={openOptions}
        setQuery={setQuery}
        submitQuery={submitQuery}
        options={
          isOpen ? (
            <Suspense
              fallback={
                <div className="label-option-empty">Loading labels</div>
              }
            >
              <LabelOptions
                assignedLabels={optimisticLabels}
                assignLabel={assignLabel}
                comboboxId={comboboxId}
                createLabel={dispatchCreateLabel}
                labelsPromise={labelsPromise}
                optimisticCreatedLabels={optimisticCreatedLabels}
                query={query}
                removeLabel={removeLabel}
              />
            </Suspense>
          ) : null
        }
      />

      {createLabelState.error ? (
        <div className="details-error">{createLabelState.error}</div>
      ) : null}
    </section>
  );
}

function LabelControls({
  comboboxId,
  isOpen,
  labels,
  openOptions,
  options,
  query,
  removeLabel,
  setQuery,
  submitQuery,
}: {
  comboboxId: string;
  isOpen: boolean;
  labels: Label[];
  openOptions: () => void;
  options?: ReactNode;
  query: string;
  removeLabel: (label: Label) => void;
  setQuery: (query: string) => void;
  submitQuery: () => void;
}) {
  return (
    <>
      <div className="label-chips" aria-label="Assigned labels">
        {labels.length === 0 ? (
          <span className="label-empty">No labels</span>
        ) : (
          labels.map((label) => (
            <span className="label-chip" key={label.id}>
              {label.name}
              <button
                aria-label={`Remove ${label.name}`}
                type="button"
                onClick={() => void removeLabel(label)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="label-combobox">
        <Search size={16} aria-hidden="true" />
        <input
          aria-autocomplete="list"
          aria-controls={`${comboboxId}-options`}
          aria-expanded={isOpen}
          id={`${comboboxId}-input`}
          placeholder="Find or create label"
          role="combobox"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            openOptions();
          }}
          onFocus={openOptions}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }

            event.preventDefault();
            void submitQuery();
          }}
        />
      </div>

      {options}
    </>
  );
}

function LabelOptions({
  assignedLabels,
  assignLabel,
  comboboxId,
  createLabel,
  labelsPromise,
  optimisticCreatedLabels,
  query,
  removeLabel,
}: {
  assignedLabels: Label[];
  assignLabel: (label: Label) => void;
  comboboxId: string;
  createLabel: (name: string) => void;
  labelsPromise: Promise<Label[]>;
  optimisticCreatedLabels: Label[];
  query: string;
  removeLabel: (label: Label) => void;
}) {
  const labels = use(labelsPromise);
  const visibleLabels = useMemo(
    () => mergeVisibleLabels(labels, optimisticCreatedLabels),
    [labels, optimisticCreatedLabels],
  );
  const assignedLabelIds = useMemo(
    () => new Set(assignedLabels.map((label) => label.id)),
    [assignedLabels],
  );
  const trimmedQuery = query.trim();
  const filteredOptions = useMemo(
    () => filterLabels(visibleLabels, trimmedQuery),
    [visibleLabels, trimmedQuery],
  );
  const canCreate = canCreateLabel(visibleLabels, assignedLabels, trimmedQuery);

  return (
    <div
      className="label-options"
      id={`${comboboxId}-options`}
      role="listbox"
    >
      {canCreate ? (
        <form
          className="label-option-form"
          onSubmit={(event) => {
            event.preventDefault();
            createLabel(trimmedQuery);
          }}
        >
          <input name="name" type="hidden" value={trimmedQuery} />
          <button
            className="label-option"
            role="option"
            type="submit"
          >
            <Plus size={16} aria-hidden="true" />
            {`Create "${trimmedQuery}"`}
          </button>
        </form>
      ) : null}

      {filteredOptions.map((label) => {
        const isAssigned = assignedLabelIds.has(label.id);
        const isOptimistic = label.isOptimistic === true;

        return (
          <button
            className="label-option"
            data-optimistic={isOptimistic ? "true" : undefined}
            data-selected={isAssigned}
            disabled={isOptimistic}
            key={label.id}
            role="option"
            type="button"
            onClick={() => {
              if (isAssigned) {
                removeLabel(label);
              } else {
                assignLabel(label);
              }
            }}
          >
            {isAssigned ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <span aria-hidden="true" />
            )}
            {label.name}
          </button>
        );
      })}

      {filteredOptions.length === 0 && !canCreate ? (
        <div className="label-option-empty">No matching labels</div>
      ) : null}
    </div>
  );
}

function reduceOptimisticLabels(
  labels: Label[],
  mutation: OptimisticLabelMutation,
) {
  if (mutation.type === "assign") {
    return mergeLabel(labels, mutation.label);
  }

  return labels.filter((label) => label.id !== mutation.labelId);
}

function mergeLabel(labels: Label[], label: Label) {
  if (labels.some((currentLabel) => currentLabel.id === label.id)) {
    return labels;
  }

  return [...labels, label].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
}

function mergeVisibleLabels(labels: Label[], optimisticLabels: Label[]) {
  const existingNames = new Set(
    labels.map((label) => normalizeLabelName(label.name)),
  );
  const visibleLabels: VisibleLabel[] = [...labels];

  for (const label of optimisticLabels) {
    if (existingNames.has(normalizeLabelName(label.name))) {
      continue;
    }

    visibleLabels.push({
      ...label,
      isOptimistic: true,
    });
  }

  return visibleLabels.sort((first, second) =>
    first.name.localeCompare(second.name),
  );
}

function filterLabels<T extends Label>(labels: T[], query: string) {
  const normalizedQuery = normalizeLabelName(query);

  if (!normalizedQuery) {
    return labels;
  }

  return labels.filter((label) =>
    normalizeLabelName(label.name).includes(normalizedQuery),
  );
}

function canCreateLabel(
  labels: Label[],
  assignedLabels: Label[],
  query: string,
) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return false;
  }

  const normalizedQuery = normalizeLabelName(trimmedQuery);

  return ![...labels, ...assignedLabels].some(
    (label) => normalizeLabelName(label.name) === normalizedQuery,
  );
}

function readLabelName(formData: FormData) {
  const value = formData.get("name");
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLabelName(name: string) {
  return name.trim().toLowerCase();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
