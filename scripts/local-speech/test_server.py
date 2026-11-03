"""Protocol checks use a fake waveform and never touch an audio device."""
import io
import json
from threading import Event, Thread
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import wave
from types import SimpleNamespace

import numpy as np
from server import create_server


class LocalSpeechTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.entered = Event()
        self.release = Event()
        self.release.set()

        def generate(text, sid, speed):
            self.calls.append((text, sid, speed))
            self.entered.set()
            self.release.wait(3)
            return SimpleNamespace(samples=np.array([0.0, 0.25, -0.25]), sample_rate=24000)

        self.server = create_server(SimpleNamespace(generate=generate, num_speakers=103, sample_rate=24000), 0)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def post(self, updates=None, headers=None):
        body = {"model": "kokoro-local", "voice": "anna", "input": "你好", "response_format": "wav"}
        body.update(updates or {})
        return urlopen(Request(self.url + "/v1/audio/speech", json.dumps(body).encode(),
                               {"Content-Type": "application/json", **(headers or {})}), timeout=5)

    def test_valid_neural_output_is_wav_with_selected_voice(self):
        with self.post() as response:
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            with wave.open(io.BytesIO(response.read())) as wav:
                self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 24000, 3))
        self.assertEqual(self.calls, [("你好", 3, 1.0)])

    def test_invalid_requests_never_run_inference(self):
        for update in [{"input": ""}, {"input": "长" * 2001}, {"model": "other"}, {"voice": "103"}, {"speed": "nan"}, {"response_format": "mp3"}]:
            with self.assertRaises(HTTPError) as error:
                self.post(update)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        self.assertEqual(self.calls, [])

    def test_webpage_cannot_request_generation(self):
        with self.assertRaises(HTTPError) as error:
            self.post(headers={"Origin": "https://example.com"})
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertEqual(self.calls, [])

    def test_health_remains_available_and_overlapping_inference_is_rejected(self):
        self.release.clear()
        def first_request():
            with self.post() as response:
                response.read()
        worker = Thread(target=first_request)
        worker.start()
        try:
            self.assertTrue(self.entered.wait(2))
            with urlopen(self.url + "/health", timeout=2) as response:
                self.assertTrue(json.load(response)["local"])
            with self.assertRaises(HTTPError) as error:
                self.post()
            self.assertEqual(error.exception.code, 429)
            error.exception.close()
        finally:
            self.release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(self.calls), 1)


if __name__ == "__main__":
    unittest.main()
