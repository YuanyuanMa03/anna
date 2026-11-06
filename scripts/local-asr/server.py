"""Local Paraformer transcription adapter. No capture, playback or remote inference."""
import io
import os
from pathlib import Path
import shutil
import subprocess
from threading import Lock

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

app = FastAPI(title='Anna local ASR', docs_url=None, redoc_url=None)
root = Path(os.environ['ANNA_ASR_MODEL_DIR'])
recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(
    tokens=str(root/'tokens.txt'), encoder=str(root/'encoder.int8.onnx'),
    decoder=str(root/'decoder.int8.onnx'), num_threads=4)
busy = Lock()
ffmpeg = os.environ.get('ANNA_FFMPEG') or shutil.which('ffmpeg')
if not ffmpeg:
    raise RuntimeError('ffmpeg is required')

@app.middleware('http')
async def body_limit(request, call_next):
    if request.method == 'POST':
        try:
            size = int(request.headers.get('content-length', '0'))
        except ValueError:
            size = 0
        if not 0 < size <= 21 * 1024 * 1024:
            return JSONResponse({'error': {'message': 'Audio request must have Content-Length and be <=21 MiB'}}, status_code=413)
    return await call_next(request)

@app.get('/health')
def health():
    return {'status':'ready','model':'paraformer-zh-en','local':True}

@app.get('/v1/models')
def models():
    return {'object':'list','data':[{'id':'paraformer-zh-en','object':'model','owned_by':'local'}]}

@app.post('/v1/audio/transcriptions')
def transcribe(file: UploadFile = File(...), model: str = Form(...), response_format: str = Form('json'), language: str = Form('')):
    if model != 'paraformer-zh-en' or response_format not in ('json','text','verbose_json') or language not in ('','zh','en'):
        raise HTTPException(400, 'Unsupported model, language or response format')
    if not busy.acquire(blocking=False):
        raise HTTPException(429, 'Local recognizer is busy')
    try:
        data = file.file.read(20 * 1024 * 1024 + 1)
        if not data or len(data) > 20 * 1024 * 1024:
            raise HTTPException(413, 'Audio must be 1 byte to 20 MiB')
        try:
            decoded = subprocess.run([ffmpeg,'-v','error','-nostdin','-protocol_whitelist','pipe',
                '-i','pipe:0','-t','121','-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'],
                input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True).stdout
        except (subprocess.SubprocessError, OSError):
            raise HTTPException(400, 'Cannot decode this audio')
        samples = np.frombuffer(decoded,dtype='<f4').copy()
        duration = len(samples)/16000
        if not 0 < duration <= 120 or not np.isfinite(samples).all():
            raise HTTPException(400, 'Audio duration must be <=120 seconds')
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, np.concatenate([samples,np.zeros(16000,dtype=np.float32)]))
        stream.input_finished()
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream)
        if response_format == 'text':
            return PlainTextResponse(text)
        result = {'text':text}
        if response_format == 'verbose_json':
            result.update(task='transcribe',duration=duration)
        return result
    finally:
        busy.release()
