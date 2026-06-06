"use client";

import type { AppType, Label } from "@lane/todo-api";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { hc } from "hono/client";
import {
  startTransition,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useState,
} from "react";

const apiUrl = process.env.NEXT_PUBLIC_TODO_API_URL ?? "http://localhost:4000";
const client = hc<AppType>(apiUrl);
const labelLimit = "500";

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
  const [options, setOptions] = useState<Label[]>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [hasRequestedOptions, setHasRequestedOptions] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const assignedLabelIds = useMemo(
    () => new Set(optimisticLabels.map((label) => label.id)),
    [optimisticLabels],
  );
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((label) =>
      label.name.toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, options]);
  const hasExactMatch = [...options, ...optimisticLabels].some(
    (label) => label.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const canCreate = trimmedQuery.length > 0 && !hasExactMatch;

  useEffect(() => {
    if (!hasRequestedOptions) {
      return;
    }

    const abortController = new AbortController();
    async function loadLabels() {
      setIsLoadingOptions(true);
      setOptionsError(null);

      try {
        const response = await client.labels.$get(
          {
            query: {
              limit: labelLimit,
            },
          },
          {
            init: {
              cache: "no-store",
              signal: abortController.signal,
            },
          },
        );

        await assertOk(response);
        setOptions((await response.json()) as Label[]);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setOptionsError(getErrorMessage(error));
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingOptions(false);
        }
      }
    }

    void loadLabels();

    return () => {
      abortController.abort();
    };
  }, [hasRequestedOptions]);

  async function createLabel(name: string) {
    const response = await client.labels.$post(
      {
        json: {
          name,
        },
      },
      {
        init: {
          cache: "no-store",
        },
      },
    );

    await assertOk(response);
    return (await response.json()) as Label;
  }

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

  async function createAndAssignLabel() {
    if (!canCreate) {
      return;
    }

    setOptionsError(null);
    setIsCreatingLabel(true);

    try {
      const label = await createLabel(trimmedQuery);
      setOptions((currentOptions) => mergeLabel(currentOptions, label));
      setQuery("");
      assignLabel(label);
    } catch (error) {
      setOptionsError(getErrorMessage(error));
    } finally {
      setIsCreatingLabel(false);
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
    setHasRequestedOptions(true);
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

      <div className="label-chips" aria-label="Assigned labels">
        {optimisticLabels.length === 0 ? (
          <span className="label-empty">No labels</span>
        ) : (
          optimisticLabels.map((label) => (
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

            const nextLabel = filteredOptions.find(
              (label) => !assignedLabelIds.has(label.id),
            );

            if (nextLabel) {
              assignLabel(nextLabel);
              return;
            }

            if (canCreate) {
              createAndAssignLabel();
            }
          }}
        />
      </div>

      {isOpen ? (
        <div
          className="label-options"
          id={`${comboboxId}-options`}
          role="listbox"
        >
          {filteredOptions.map((label) => {
            const isAssigned = assignedLabelIds.has(label.id);

            return (
              <button
                className="label-option"
                data-selected={isAssigned}
                disabled={isAssigned}
                key={label.id}
                role="option"
                type="button"
                onClick={() => assignLabel(label)}
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

          {canCreate ? (
            <button
              className="label-option"
              disabled={isCreatingLabel}
              role="option"
              type="button"
              onClick={() => createAndAssignLabel()}
            >
              <Plus size={16} aria-hidden="true" />
              {isCreatingLabel ? "Creating label..." : `Create "${trimmedQuery}"`}
            </button>
          ) : null}

          {!isLoadingOptions && filteredOptions.length === 0 && !canCreate ? (
            <div className="label-option-empty">No matching labels</div>
          ) : null}

          {isLoadingOptions ? (
            <div className="label-option-empty">Loading labels</div>
          ) : null}
        </div>
      ) : null}

      {optionsError ? <div className="details-error">{optionsError}</div> : null}
    </section>
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

async function assertOk(response: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}) {
  if (response.ok) {
    return;
  }

  const fallback = `Request failed with ${response.status}`;
  const body = await response.text();

  if (!body) {
    throw new Error(fallback);
  }

  let data: { error?: unknown } | null = null;

  try {
    data = JSON.parse(body) as { error?: unknown };
  } catch {
    // Keep the raw response body for non-JSON errors.
  }

  if (typeof data?.error === "string") {
    throw new Error(data.error);
  }

  throw new Error(body);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
