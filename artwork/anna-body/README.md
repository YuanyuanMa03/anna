# Anna's body: sources

The sources of `assets/anna-body/anna.mavatar`, built with
[Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio):

- `source.png`: her front-facing portrait, 1672 × 941. Generated with AI tools.
- `variants/`: the same portrait with closed, half-closed, smiling, sad and surprised eyes and six mouths.
- `rig.json`, `avatar.json`: the rig and the manifest.

To rebuild the archive, copy this folder to `projects/anna` in a Studio checkout (Studio refuses symlinks) and run:

```sh
uv run --with numpy --with pillow --with opencv-python-headless tools/build-layers.py projects/anna
uv run tools/build-sprites.py projects/anna
npm run pack-avatar -- projects/anna --no-source -o <anna>/assets/anna-body/anna.mavatar
```

When the art changes, update `body.crop` and `body.hands` in `packages/character/manifest.ts`, which are in image pixels.
