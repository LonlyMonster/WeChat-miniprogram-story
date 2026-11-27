import io
import sys

from PIL import Image, ImageOps


with Image.open(io.BytesIO(sys.stdin.buffer.read())) as source:
    image = ImageOps.exif_transpose(source).convert("RGBA")
    image.thumbnail((384, 384), Image.Resampling.LANCZOS)
    image.save(sys.stdout.buffer, "WEBP", quality=82)
