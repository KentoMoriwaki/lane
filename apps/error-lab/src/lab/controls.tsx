"use client";

import type { ReactNode } from "react";

/** A labelled line of controls. The label column is what makes the layering read. */
export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-xs text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

export function Button({
  onClick,
  disabled,
  small,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded border border-zinc-300 bg-white disabled:opacity-40 ${
        small ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Radios, for the settings that are worth seeing all the options of at once. */
export function Choice<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex items-center gap-3 text-sm">
      <legend className="sr-only">{name}</legend>
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {option}
        </label>
      ))}
    </fieldset>
  );
}

/** The same choice where space is short — one per card, many cards on screen. */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-zinc-500">
      {label}
      <select
        className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-900"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  small,
  onChange,
}: {
  label: string;
  checked: boolean;
  small?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-1 ${small ? "text-xs text-zinc-500" : "text-sm"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
