# Photo underlay

Trace a photo or scan under the map (Epic 6 E6-5, decision D48): an acetate overlay photographed on its
map, a scanned sketch, or the map sheet itself. For lines and areas with many points it is faster and
more accurate than typing grids (the transfer methods in `docs/ANALOG-DIGITAL-WORKFLOW.md`).

## Placing the photo

**Map → Photo underlay (trace) → Load photo…**, then in *Place the photo*:

1. **Click a point** on the photo whose grid you can read; a grid-line crossing is best. A numbered
   mark shows where you clicked; zoom the photo to 200 % or 400 % to click precisely.
2. **Type its grid** (`18S UJ 2100 0900`, or `lat, lng`).
3. Repeat for **at least 3 points, spread over the photo** (near the corners, not in a line).
   - 3 points place a flat scan, or a photo taken square on.
   - **4 or more** also correct the **perspective** of a photo taken at an angle. Use 5 or 6.
4. **Check the fit.** Each point shows how far off it is in metres, and the fit overall (RMS). A point
   much further off than the others is a wrong click or a mistyped grid: fix or remove it.
5. **Show on map.**

The photo is drawn under the units, lines and areas, warped to the ground. Set its **opacity** to
see the map through it, **Edit points** to refine the fit, **Remove photo** when done.

## Tracing

Use the normal tools (Lines & areas, Add unit) over the photo. **Snap** (to points, the grid, angles)
and the **MGRS grid** work as usual; the photo itself is not snapped to. Read back what you traced as
for any transfer.

## What to expect

- **Accuracy** is that of the fit (shown) plus how sharp the photo is. A phone photo of a 1:50 000 map
  usually fits within 20 to 50 m with 5 points; a flat scan better.
- A curled or folded sheet does not fit a flat plane: use more points near the area you trace, and
  check the residuals.
- **The photo stays in this browser tab.** It is not stored, sent or exported, and is gone when the tab
  is closed or reloaded. Keep the photo itself with its marking, as for the paper it shows.
