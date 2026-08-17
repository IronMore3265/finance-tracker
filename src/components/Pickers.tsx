/**
 * Colour and icon pickers, shared by the category and account dialogs.
 *
 * The two use different controls on purpose.
 *
 * **Colour** is a `ToggleButtonGroup`: fourteen swatches read as a palette
 * strip, seeing them all at once is the entire point of choosing a colour, and
 * the group collapses them into a single tab stop with arrow-key navigation.
 *
 * **Icon** is a `Selector` with search. The same treatment would put 27 joined
 * buttons — and 27 tab stops — in a 520px dialog, which neither fits nor is
 * navigable. A searchable dropdown stays one tab stop however many icons the
 * registry grows to, and typing "car" beats hunting a grid.
 */
import {Field} from '@astryxdesign/core/Field';
import {Icon} from '@astryxdesign/core/Icon';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {ToggleButton, ToggleButtonGroup} from '@astryxdesign/core/ToggleButton';
import {Circle} from 'lucide-react';
import {useId, useMemo} from 'react';
import {
  CATEGORY_ICONS,
  CATEGORY_ICON_NAMES,
  ENTITY_COLORS,
  EntityIcon,
} from './EntityIcon';

export interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (colorHex: string) => void;
}

export function ColorPicker({label, value, onChange}: ColorPickerProps) {
  const id = useId();

  return (
    <Field label={label} inputID={id}>
      <Stack direction="horizontal" gap={1} wrap="wrap" id={id}>
        <ToggleButtonGroup
          value={value}
          onChange={(next) => {
            // The group reports null when the pressed button is pressed again,
            // and string[] only in multiple mode. A row with no colour is not
            // a state the schema allows, so deselection is ignored.
            if (typeof next === 'string') onChange(next);
          }}
          label={label}
          size="sm"
        >
          {ENTITY_COLORS.map((color) => (
            <ToggleButton
              key={color}
              value={color}
              // A colour has no name a screen reader can use; the hex is at
              // least unique, and readable aloud.
              label={color}
              isIconOnly
              icon={
                // `fill` as well as `color`: Lucide sets fill="none" on the
                // svg, and an inline style beats a presentation attribute, so
                // this turns the outlined circle into a solid swatch.
                <Icon icon={Circle} size="sm" style={{color, fill: color}} />
              }
            />
          ))}
        </ToggleButtonGroup>
      </Stack>
    </Field>
  );
}

export interface IconPickerProps {
  label: string;
  value: string;
  onChange: (iconName: string) => void;
  /** The chosen colour, so the picker previews the actual result. */
  color?: string;
  /** Restrict the choices, e.g. to the four account icons. */
  names?: readonly string[];
}

export function IconPicker({
  label,
  value,
  onChange,
  color,
  names = CATEGORY_ICON_NAMES,
}: IconPickerProps) {
  const options = useMemo(
    () => names.map((name) => ({value: name, label: describeIcon(name)})),
    [names],
  );

  return (
    <Selector
      label={label}
      value={value}
      onChange={(next) => {
        if (next !== null) onChange(next);
      }}
      options={options}
      hasSearch={names.length > 8}
      searchPlaceholder="Search icons"
      width="100%"
      renderOption={(option) => (
        <Stack direction="horizontal" gap={2} vAlign="center">
          <EntityIcon
            name={String(option.value)}
            size="sm"
            {...(color !== undefined && {color})}
          />
          {option.label}
        </Stack>
      )}
    />
  );
}

/** `'shopping-bag'` -> `'Shopping bag'`, for labels and search. */
function describeIcon(name: string): string {
  const words = name.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True when `name` is one this build can render. Guards imported data. */
export function isKnownCategoryIcon(name: string): boolean {
  return name in CATEGORY_ICONS;
}
