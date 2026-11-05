"""Local neural ASR and Kokoro TTS for Anna. Never captures or plays audio."""
import argparse
import io
import json
import math
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
import wave

import numpy as np

MODEL = "kokoro-local"
ASR_MODEL = "paraformer-local"


def create_server(tts, port, recognizer=None):
    busy = BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            pass  # Do not log user text or request bodies.

        def respond(self, status, body, content_type="application/json"):
            if content_type == "application/json":
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"status": "ready", "model": MODEL, "local": True,
                                   "speakers": tts.num_speakers, "sample_rate": tts.sample_rate})
            elif self.path == "/v1/models":
                models = [{"id": MODEL, "object": "model", "owned_by": "local"}]
                if recognizer is not None:
                    models.append({"id": ASR_MODEL, "object": "model", "owned_by": "local"})
                self.respond(200, {"object": "list", "data": models})
            else:
                self.respond(404, {"error": "Unknown endpoint"})

        def do_POST(self):
            if self.path == "/v1/audio/transcriptions":
                self.transcribe()
                return
            if self.path != "/v1/audio/speech":
                self.respond(404, {"error": "Unknown endpoint"})
                return
            # Anna's Host has no Origin header. Refuse direct web-page requests.
            if self.headers.get("Origin") or self.headers.get("Transfer-Encoding"):
                self.respond(403, {"error": "Browser and chunked requests are not supported"})
                return
            if self.headers.get_content_type() != "application/json":
                self.respond(415, {"error": "Use application/json"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    raise ValueError()
                request = json.loads(self.rfile.read(length))
                text = request["input"]
                if not isinstance(text, str) or not 0 < len(text.strip()) <= 2000:
                    raise ValueError()
                if request.get("model") != MODEL or request.get("response_format", "wav") != "wav" or request.get("stream"):
                    raise ValueError()
                voice = request.get("voice", "anna")
                sid = 3 if voice in ("anna", "zf_001") else int(voice)
                speed = float(request.get("speed", 1.0))
                if not 0 <= sid < tts.num_speakers or not math.isfinite(speed) or not 0.5 <= speed <= 2:
                    raise ValueError()
            except (ValueError, TypeError, KeyError, OverflowError):
                self.respond(400, {"error": "Invalid text, model, voice, speed or format"})
                return
            if not busy.acquire(blocking=False):
                self.respond(429, {"error": "Local model is busy; retry after the current sentence"})
                return
            try:
                audio = tts.generate(text, sid=sid, speed=speed)
                samples = np.asarray(audio.samples)
                if not 0 < samples.size <= audio.sample_rate * 120 or not np.isfinite(samples).all():
                    raise ValueError("Invalid model output")
                output = io.BytesIO()
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(audio.sample_rate)
                    wav.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
                self.respond(200, output.getvalue(), "audio/wav")
            except Exception:
                self.respond(500, {"error": "Local synthesis failed"})
            finally:
                busy.release()

        def transcribe(self):
            if self.headers.get("Origin") or self.headers.get("Transfer-Encoding"):
                self.respond(403, {"error": "Browser and chunked requests are not supported"})
                return
            if recognizer is None:
                self.respond(503, {"error": "Start with --asr-model and --asr-tokens to enable local recognition"})
                return
            if self.headers.get_content_type() != "multipart/form-data":
                self.respond(415, {"error": "Use multipart/form-data with a WAV file"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 20 * 1024 * 1024:
                    raise ValueError()
                content_type = self.headers.get("Content-Type", "").encode("ascii")
                if len(content_type) > 256:
                    raise ValueError()
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise ValueError()
                message = BytesParser(policy=default).parsebytes(b"Content-Type: " + content_type + b"\r\nMIME-Version: 1.0\r\n\r\n" + payload)
                fields = {}
                for part in message.iter_parts():
                    name = part.get_param("name", header="content-disposition")
                    if name not in ("model", "file", "response_format") or name in fields:
                        raise ValueError()
                    fields[name] = part.get_payload(decode=True)
                if fields.get("model") != ASR_MODEL.encode() or fields.get("response_format", b"json") != b"json":
                    raise ValueError()
                with wave.open(io.BytesIO(fields["file"]), "rb") as wav:
                    if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000 or not 0 < wav.getnframes() <= 16000 * 120:
                        raise ValueError()
                    frames = wav.readframes(wav.getnframes())
                    if len(frames) != wav.getnframes() * 2:
                        raise ValueError()
                    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768
            except (ValueError, TypeError, KeyError, OverflowError, wave.Error, EOFError):
                self.respond(400, {"error": "Invalid model, multipart fields or PCM16 mono 16 kHz WAV"})
                return
            if not busy.acquire(blocking=False):
                self.respond(429, {"error": "Local model is busy; retry after the current request"})
                return
            try:
                stream = recognizer.create_stream()
                stream.accept_waveform(16000, samples)
                recognizer.decode_stream(stream)
                self.respond(200, {"text": stream.result.text})
            except Exception:
                self.respond(500, {"error": "Local recognition failed"})
            finally:
                busy.release()

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def load_model(directory):
    import sherpa_onnx

    root = Path(directory).resolve()
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(root / "model.int8.onnx"), voices=str(root / "voices.bin"),
                tokens=str(root / "tokens.txt"),
                lexicon=",".join(str(root / name) for name in ["lexicon-us-en.txt", "lexicon-zh.txt"])),
            num_threads=4, provider="cpu"),
        rule_fsts=",".join(str(root / name) for name in ["phone-zh.fst", "date-zh.fst", "number-zh.fst"]))
    if not config.validate():
        raise ValueError("Local Kokoro model files are missing or invalid")
    return sherpa_onnx.OfflineTts(config)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--port", type=int, default=17861)
    parser.add_argument("--asr-model", help="Optional offline Paraformer ONNX model")
    parser.add_argument("--asr-tokens", help="Token file for the offline Paraformer model")
    args = parser.parse_args()
    if bool(args.asr_model) != bool(args.asr_tokens):
        parser.error("--asr-model and --asr-tokens must be supplied together")
    recognizer = None
    if args.asr_model:
        import sherpa_onnx
        for filename in (args.asr_model, args.asr_tokens):
            if not Path(filename).is_file():
                parser.error(f"Model file does not exist: {filename}")
        recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=str(Path(args.asr_model).resolve()), tokens=str(Path(args.asr_tokens).resolve()),
            num_threads=4, sample_rate=16000, feature_dim=80, decoding_method="greedy_search", provider="cpu")
    server = create_server(load_model(args.model_dir), args.port, recognizer)
    print(f"Anna local Kokoro ready at http://127.0.0.1:{server.server_port}/v1", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
