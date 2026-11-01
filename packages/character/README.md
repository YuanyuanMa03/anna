# Character assets

The manifest holds one companion, Anna. Her Live2D form is the Haru sample model, with a character card: a name, a
personality appended to the persona, a greeting, a voice and the model's own motions for stage cues. Her id stays
`haru`, because settings on disk carry it. `fitStage` contains the complete model canvas inside the visible stage.

## Anna's own body

Anna has two forms: her Live2D anime form (Haru) and her own body, a mesh avatar built from her original art with
[Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio) and drawn by its `mesh-avatar` runtime. The person
picks one under 外观与能力; the choice is kept per machine.

The archive is committed at `assets/anna-body/anna.mavatar`, so every clone, build and package carries it. Its sources
are in `artwork/anna-body/`, which also says how to rebuild it. If it cannot be shown (no WebGL 2, say), the stage falls
back to the anime form and 外观与能力 says why.

The manifest's `body.crop` (the figure's bounds) and `body.hands` (where she holds things) are in image pixels: update
them when the art changes. Face, mouth and head come from the archive's rig.

## The person's own Anna

更多 → 创造我的 Anna turns material the person brings into a third form, kept in the window's own storage with the other
stage preferences (`apps/desktop/src/my-avatar.ts`):

- **A picture.** Five clicks (both eyes, mouth, chin, top of the head) and `make-avatar.ts` works out a complete rig, clears a
  plain background and draws what one picture does not hold, the eye half and fully closed, in the picture's own colours.
  It needs no network, no model and no tools, and takes a second. Her hair does not sway and her expressions are simple.
- **A finished `.mavatar`**, from Studio or anywhere else. The runtime checks it before it is kept.
- **Handing the picture to her.** `avatar-task.ts` asks her brain, as an ordinary task under her permissions, to follow Studio's
  agent guide in her workspace. It takes tens of minutes and a brain that can read images; what comes out is a `.mavatar`
  for the point above.

`body.ts` is the body language, pure and tested: a beat for every runtime phase (face, entry motion, a working motion
repeated while the phase lasts, where she looks), reactions to touch and stage cues, attention while the person moves
or types, and dozing off when left alone. `body-stage.vue` owns the runtime and feeds it gaze, motions, expressions and
a speech rhythm for the mouth.

The Vue stage uses the manifest and owns Pixi resources.
A character never owns an agent Session or model provider.
Asset sources, SHA-256 values, and licenses are in `docs/asset-inventory.json` and `NOTICE.md`.
