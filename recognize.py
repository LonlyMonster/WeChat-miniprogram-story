import json
import sys
import subprocess
from array import array
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
audio = sys.stdin.buffer.read()
if sys.argv[2] == "mp3":
    from imageio_ffmpeg import get_ffmpeg_exe
    decoded = subprocess.run(
        [get_ffmpeg_exe(), "-v", "error", "-protocol_whitelist", "pipe",
         "-format_whitelist", "mp3,wav,matroska,webm,ogg,aac,mov",
         "-i", "pipe:0", "-t", "60", "-ac", "1", "-ar", "16000",
         "-f", "s16le", "pipe:1"],
        input=audio, capture_output=True, timeout=15
    )
    if decoded.returncode or not decoded.stdout:
        sys.exit(2)
    audio = decoded.stdout
if max(map(abs, array("h", audio)), default=0) <= 2:
    sys.exit(3)
recognizer = KaldiRecognizer(Model(sys.argv[1]), 16000)
parts = []
for offset in range(0, len(audio), 8000):
    chunk = audio[offset:offset + 8000]
    if recognizer.AcceptWaveform(chunk):
        parts.append(json.loads(recognizer.Result())["text"])
parts.append(json.loads(recognizer.FinalResult())["text"])
sys.stdout.buffer.write("".join(parts).replace(" ", "").encode("utf-8"))
