# UI style: the panel's visual language

All shared styles live in `css/app.css` under "Shared controls"; colours and spacing are tokens in
`css/tokens.css` (light and dark). New UI uses these pieces instead of styling its own.

## Building blocks

| Piece | Markup | Use it for |
|---|---|---|
| Group | `<fieldset class="group"><legend>Title</legend>…</fieldset>` | Every boxed set of related controls (Base map, Slide frame, Classification marking, New line…, Symbol). One look: rounded, subtle border, small muted legend. |
| Segmented choice | `<div class="segmented"><label><input type="radio" name="…" value="…"><span>Text</span></label>…</div>` | 2–3 short, exclusive options (slide shape, base map, data format). Real radio inputs, so keyboard and screen readers work. |
| Dropdown | `<select>` in a `.field` | 4 or more options, or long option names (kind, side, affiliation, unit type). |
| Field | `<label class="field"><span>Name</span><input|select></label>` | Every labelled input. Two fields side by side: wrap them in `.position`. |
| Tick box | `<label class="check"><input type="checkbox"><span>Text</span></label>` | On/off settings, inside the group they belong to. |
| Actions | `<div class="actions">buttons…</div>` | Every row of buttons: auto width, wrapping. |
| Subheading | `<h3 class="subheading">` | Editors inside a section ("Edit unit", "Edit PL GOLD"). |
| Hint | `<p class="hint">` | Help text and explanations (muted). Hidden when empty. |
| Status | `<p class="status" role="status">` | Results of an action ("Saved …", "Drawing on the map…"). Hidden when empty. |
| Error | `.field-error` under a field, `.alert` for a section | Problems. Hidden when empty. |
| List row | `<button class="list-row" aria-current="true|null">` | Selectable rows (units, lines and areas). The selected row is outlined in the accent colour. |

## Buttons

| Class | Meaning | Examples |
|---|---|---|
| `primary` | The one main action of a form or group. At most one per group. | Add, Save, Draw, Export PNG |
| (none) | Other actions | Cancel, Copy unit, Export all COAs, Download… |
| `danger` | Destructive: outlined in red. Only the confirm dialog's button is filled red. | Delete unit, Delete |
| `link` | Low-emphasis actions in lists and messages | Rename, Duplicate, Show more, Import COAs…, Cancel in a map hint |

## Rules

- `hidden` always hides (`[hidden] { display: none !important }`), whatever display a class sets.
- No colours in views: use tokens (`--color-accent`, `--color-danger`, …), so dark mode works.
  Map graphics are the exception: their colours are data (side colours).
- Text from users and files is set with `textContent` or text nodes, never as HTML.
- On the map, hints use `.pick-hint` (top right) and messages `.map-message` (bottom left).
