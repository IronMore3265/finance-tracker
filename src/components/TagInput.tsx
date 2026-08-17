/**
 * Free-form tags with suggestions from what is already in use.
 *
 * Tags are stored as a `string[]` on each transaction and indexed multi-entry
 * (`*tags` in db.ts), so filtering by tag hits an index rather than scanning.
 * They are deliberately not a table — a tag has no properties beyond its own
 * text, and making one would mean a management screen nobody asked for.
 *
 * `hasCreate` is what makes this work for tags specifically: the dropdown
 * offers existing tags so the same idea does not get entered as "food" and
 * "Food", while still accepting anything new without a round trip.
 */
import {Tokenizer} from '@astryxdesign/core/Tokenizer';
import {createStaticSource} from '@astryxdesign/core/Typeahead';
import {useMemo} from 'react';

export interface TagInputProps {
  label: string;
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** Every tag already used in the ledger, for suggestions. */
  suggestions: readonly string[];
  description?: string;
}

export function TagInput({
  label,
  value,
  onChange,
  suggestions,
  description,
}: TagInputProps) {
  // A tag *is* its own identity, so id and label are the same string. That is
  // also what makes the round trip lossless: whatever the Tokenizer hands back
  // is exactly what gets stored.
  const source = useMemo(
    () => createStaticSource(suggestions.map((tag) => ({id: tag, label: tag}))),
    [suggestions],
  );

  const items = useMemo(() => value.map((tag) => ({id: tag, label: tag})), [value]);

  return (
    <Tokenizer
      label={label}
      value={items}
      searchSource={source}
      onChange={(next) => {
        // Normalised on the way in, so "Food", "food " and "food" are one tag
        // rather than three that look identical in a filter list.
        const cleaned = next
          .map((item) => item.label.trim().toLowerCase())
          .filter((tag) => tag.length > 0);
        onChange([...new Set(cleaned)]);
      }}
      hasCreate
      hasEntriesOnFocus
      hasClear
      placeholder="Add a tag"
      width="100%"
      {...(description !== undefined && {description})}
    />
  );
}
