# Character assets

The manifest lists five companions (two women, three men); Haru is Anna, the first companion. Each pairs a Live2D sample model with a character card:
a name, a personality appended to the shared persona, a greeting, a voice and the model's own motions for stage cues.
`paramId` maps the standard parameter names the stage drives onto models that name them differently (Cubism 2-era
`PARAM_*` names, Mao's `ParamA` mouth). `fitStage` contains the complete model canvas inside the visible stage.

## Anna's own body

Anna has two forms: her Live2D anime form (Haru) and her own body, a mesh avatar built from her original art with
[Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio) and drawn by its `mesh-avatar` runtime. The person
picks one under 外观与能力; the choice is kept per machine.

The body archive is not committed. To put it in place, pack the Studio project without its source image:

```sh
npm run pack-avatar -- projects/anna --no-source -o <anna>/assets/anna-body/anna.mavatar   # in the Studio checkout
```

The dev server (`pnpm dev:desktop`) uses it when it is in place. A build carries it only when asked to:
`ANNA_WITH_BODY=1 pnpm build`, for the owner's own machine. Never publish such a build or package: the archive holds
her art. Without it the app shows the anime form, never tries to load the body and does not offer the choice.
The manifest's `body.crop` (the figure's bounds) and `body.hands` (where she holds things) are in image pixels: update
them when the art changes. Face, mouth and head come from the archive's rig.

`body.ts` is the body language, pure and tested: a beat for every runtime phase (face, entry motion, a working motion
repeated while the phase lasts, where she looks), reactions to touch and stage cues, attention while the person moves
or types, and dozing off when left alone. `body-stage.vue` owns the runtime and feeds it gaze, motions, expressions and
a speech rhythm for the mouth.

The Vue stage uses the manifest and owns Pixi resources.
A character never owns an agent Session or model provider.
Asset sources, SHA-256 values, and licenses are in `docs/asset-inventory.json` and `NOTICE.md`.
