# Character assets

The manifest lists six companions (three women, three men). Each pairs a Live2D sample model with a character card:
a name, a personality appended to the shared persona, a greeting, a voice and the model's own motions for stage cues.
`paramId` maps the standard parameter names the stage drives onto models that name them differently (Cubism 2-era
`PARAM_*` names, Mao's `ParamA` mouth). `fitStage` contains the complete model canvas inside the visible stage.

The Vue stage uses the manifest and owns Pixi resources.
A character never owns an agent Session or model provider.
Asset sources, SHA-256 values, and licenses are in `docs/asset-inventory.json` and `NOTICE.md`.
