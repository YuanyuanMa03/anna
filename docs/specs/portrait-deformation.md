# Frontal portrait deformation

Anna's own body currently uses a single frontal illustration, eye/mouth sprites and a mesh-avatar 0.4.0 rig. It does not contain side-view face planes or a reconstructed skull. Applying elliptical head translation and independent nose/eye/ear parallax invents depth by stretching the original pixels. Pointer tracking, idle motions and speech then stack on that field.

## Binding

`stabilizeBodyRig` creates a private runtime copy of the archive rig. The archive and touch regions stay unchanged. In this copy:

- Elliptical turn translation is disabled; skull roll and the existing neck transition remain.
- `rigidFace` opts out of invented per-feature turn parallax. A narrow, reproducible pnpm patch adds this optional flag to mesh-avatar 0.4.0. Avatars without the flag retain the original deformation path. The upstream package is MIT licensed; the patch does not vendor the library.
- Skull roll and strand displacement are reduced independently. Hair springs remain active with limited excursions.
- Pointer gaze stays near the original iris opening, with slower head follow, a velocity limit, and frame-rate independent smoothing.
- Speech uses the existing drawn vowels with reduced openness and head accompaniment; lip movement is retained.

This preserves the frontal portrait's shape rather than treating its cheeks and hair as side-view surfaces. It is not a full Live2D layer reconstruction or a 3D model. Strong yaw, independent rear hair/skull rotations and hidden facial surfaces would need additional artwork and a different binding, not larger deformation amplitudes.

## Evidence

Local evidence is under ignored `artifacts/body-stability/`, using the actual private avatar archive and installed patched runtime. No illustration, archive or review screenshot is committed.

- `comparison.png`: actual WebGL renders, before/after rest, two pointer extremes and a controlled speech peak. These are deterministic renderer probes, not a live provider/voice acceptance test.
- `strain.json`: maximum relative length change of 10-pixel horizontal/vertical segments on a neutral face grid. With the same angles (14, -10, 6), the original binding measured 20.796%; the stable binding measured approximately 1.35e-14. This excludes expression, jaw, hair physics and neck deformation, and does not measure perceived comfort.
- Unit regression uses explicitly synthetic geometry to check skull distances in the installed kernel, source-rig immutability, eye/mouth registration, frame-rate consistency and abrupt pointer reversals. The kernel probe is deliberately pinned to this library version; upgrading it requires reviewing the patch and probe.

Validation: typecheck, lint, production build and 482 unit tests passed; 19 optional tests skipped. The current development desktop is still served from the `anna-body` worktree. Live provider conversation, audio alignment and subjective animation acceptance are not established by these checks.
