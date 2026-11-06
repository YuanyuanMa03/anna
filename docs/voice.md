# Desktop voice conversation

Anna is a desktop application with direct speech services. It does not require New API, a gateway, a service workbench, Python or model weights to start. Existing brains, provider routing, tools, permissions, memories, avatars and Weixin remain available.

Open **语音对话 → 语音设置**. Recognition and synthesis each select **本地部署** or **云端 API**, independently. New forms start on **云端 API** with a Xiaomi MiMo Token Plan preset (`https://token-plan-cn.xiaomimimo.com/v1`, **接口格式** 对话接口, recognition `mimo-v2.5-asr`, synthesis `mimo-v2.5-tts` with voice `冰糖`), because a fresh install has no local speech service; only the key is missing. Pay-as-you-go MiMo keys (`sk-`) use `https://api.xiaomimimo.com/v1`. When recognition and synthesis use the same address, a key saved for one also serves the other, and it is never sent to any other address. Clearing one side's key does not stop the other side's key being used at that shared address; give them different addresses or clear both. Save a service address including its API prefix (usually `/v1`), the actual model ID, and its key if required. Synthesis also needs a voice ID. Changing service addresses requires entering a new key or explicitly clearing the previous one. The renderer only sees whether a key exists.

**接口格式** selects how speech is sent:

- **对话接口** (`chat`, Xiaomi MiMo's convention; OpenAI's own audio chat models also need `modalities` and are not covered): both directions use `POST /chat/completions`. Synthesis sends the text as the assistant turn and `audio: { format: "wav", voice }`, and reads base64 audio from `choices[0].message.audio.data`; the form suggests MiMo's built-in voices. Recognition sends the WAV as an `input_audio` data URL in the user turn (at most 10,000,000 characters including the prefix, about 7.5 MB of WAV; Anna's two-minute recordings are about 3.8 MB) and reads `choices[0].message.content`.
- **OpenAI 语音接口** (`audio`, the default for older settings and local services):
  - Recognition uses `POST /audio/transcriptions`, multipart fields `model`, `file` and `response_format=json`, and expects `{ "text": "..." }`.
  - Synthesis uses `POST /audio/speech`, JSON fields `model`, `voice`, `input` and `response_format=wav`.

For both:

- Synthesised audio must be WAV, MP3, Ogg or FLAC. A reply labelled `application/octet-stream`, a variant WAV/MP3 spelling or no type at all is accepted when its own header is one of these.
- Saving one side on the cloud preset's address also saves the other side with its preset, if that side was never set up and is untouched, so a new user enters one key and saves once.
- In conversation, the next sentence is synthesised while the current one plays.
- A 401 or 403 says the key is invalid or does not match the address; a 404 or 405 suggests checking the address and 接口格式. Provider error text is never shown.
- Local mode accepts loopback services (`127.0.0.1`, `localhost`, `::1`), including HTTP. Cloud mode requires HTTPS. Neither follows redirects.
- These are compatible API contracts, not adapters for every provider's proprietary protocol. Confirm that the selected service supports the required endpoint.

Select an audio file or explicitly start microphone recording. Recordings are converted to PCM16 mono 16 kHz WAV without playback, limited to two minutes and a 20 MiB input. Recognition sends the audio only to the saved recognition endpoint. Check/edit the transcript, then choose **将文字带到对话** or **发送并语音回复**. The latter uses the current brain and enables model speech for this app session. It is disabled until a synthesis service is saved and the current workspace is ready for chat.

Model speech starts off at every launch. The homepage can stop playback or disable it. Closing the voice panel stops microphone capture and cancels its pending recognition/synthesis requests. Cancellation stops Anna from receiving or playing the result; a remote model may finish its underlying inference. A canceled or late permission grant cannot restart recording. There is no camera, screen capture, visual inference, wake word or background listening.

The synthesis test creates a downloadable audio file without automatically playing it. Cloud requests may incur the selected provider's charges. Voice input through a local recognizer does not make a cloud language model local: the current brain still determines where the transcript is processed.

## Local model service

The optional service in `scripts/local-speech/` runs separately from the desktop package and has no New API dependency. It binds only to loopback and does not capture or play audio. Install on the machine that will run the local models, using a separate Python environment. Python 3.12 is a suitable target for the pinned requirements; availability of native wheels must be checked on the target OS/architecture.

```sh
python3.12 -m venv .venv-voice
# Windows: use .venv-voice\Scripts\python.exe for the following Python commands.
.venv-voice/bin/python -m pip install -r scripts/local-speech/requirements.txt
.venv-voice/bin/python scripts/local-speech/server.py --model-dir "/path/to/kokoro" --asr-model "/path/to/offline-paraformer/model.int8.onnx" --asr-tokens "/path/to/offline-paraformer/tokens.txt"
```

Supply an offline Paraformer model supported by sherpa-onnx; the former streaming Sherpaw `preload.data` package is a different format and cannot be passed as this ONNX model. Model acquisition/licensing and native inference must be verified separately. The service does not download models. Kokoro expects the files described by `load_model` in `server.py`, including its lexicons, token file, voices and rule FSTs. Upstream references: [Kokoro](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html), [offline recognition API example](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/offline-decode-files.py).

Configure both local speech addresses as `http://127.0.0.1:17861/v1`, recognition model `paraformer-local`, synthesis model `kokoro-local`, voice `anna`, and explicitly empty keys. `--asr-model` and `--asr-tokens` are optional together; omitting both starts TTS only, and recognition returns an explicit 503. The service serializes model work, rejects overlap with 429, and keeps health/model listing available. Ctrl+C stops it. Desktop startup does not start this service.

## Upgrade and distribution

Existing TTS settings and keys continue to use the encrypted `senses.bin` vault; the filename is retained for compatibility. Missing legacy mode is inferred from the endpoint. Existing recognition model copies, vision credentials, New API databases and any separately running services are left untouched. This change removes their application code and entry points; it does not uninstall other software or delete user data. Existing agent providers may still point to an independently managed compatible gateway.

Desktop packages collect the Host's actual runtime dependency closure and archive it into `app.asar`, retaining dependency versions and peer contexts. Electron is supplied by the outer application. Frontend-only dependencies and Sherpaw WASM are not installed again inside the runtime. Sandbox executables and their small dependency closure remain outside the archive so executable paths stay real. Native addons are unpacked. License files are preserved; source maps and declaration-only files are omitted from the distribution. Source builds and packaged desktop flows must both pass.

Windows packages are built on Windows with `pnpm package:windows` and `pnpm package:windows-installer`; macOS uses `pnpm package:mac`, Linux uses `pnpm package:linux` / `pnpm package:deb`. Do not claim a new Windows installer was validated from a macOS-only build. Transfer the installer to the target's local disk with the remote tool; a source checkout is unnecessary.

## Verification boundaries

Automatic desktop checks use synthetic WAV data, fake speech HTTP responses, fake brains and mocked playback. They validate routing, conversion, persistence, cancellation and interaction, not transcription accuracy, voice quality or real microphone compatibility. The optional Python protocol suite uses a fake recognizer and synthetic waveform. Opt-in local model acceptance uses a separately running local service and a public/synthetic reference recording; it never opens real devices or plays audio. Cloud provider compatibility and target-platform model availability require separate acceptance.

Run the local protocol checks after installing the optional requirements with `python scripts/local-speech/test_server.py`. To exercise real local models through the desktop, start the local ASR/TTS service, build the app, then run `ANNA_LOCAL_VOICE_ACCEPT=1 node tests/accept-local-voice.mjs` (PowerShell: set `$env:ANNA_LOCAL_VOICE_ACCEPT="1"` first). Override `ANNA_LOCAL_VOICE_URL` for a different loopback port. The acceptance synthesizes a reference phrase and checks the returned transcript; its report is `artifacts/local-voice-acceptance.json`. This is a functional round trip, not an accuracy benchmark.
