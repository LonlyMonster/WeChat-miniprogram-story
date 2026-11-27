import io
import struct
import sys

from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat


def restore(reference, generated):
    # Work on a small mask; composite the untouched full-resolution originals.
    if reference.size != generated.size or min(reference.size) < 256:
        return None
    size = tuple(max(1, n // 4) for n in generated.size)
    prev, curr = [im.resize(size, Image.Resampling.BOX) for im in (reference, generated)]
    # Estimate the paper colour from the brightest half of the image.
    luminance = ImageOps.grayscale(prev)
    paper = luminance.point(lambda x: 255 if x >= 225 else 0)
    if paper.histogram()[255] < prev.width * prev.height * 0.40:
        return None
    color = tuple(ImageStat.Stat(prev, paper).median)
    def distance(im):
        channels = ImageChops.difference(im, Image.new("RGB", size, color)).split()
        return ImageChops.lighter(ImageChops.lighter(*channels[:2]), channels[2])
    # Only reuse broad, uniform paper in the reference. Keep its line art intact.
    blank = distance(prev).point(lambda x: 255 if x < 14 else 0).filter(ImageFilter.MinFilter(5))
    delta = distance(curr)
    # Dense colour and continuous strokes belong to the new artwork.
    solid = delta.filter(ImageFilter.MedianFilter(7)).point(lambda x: 255 if x > 68 else 0)
    solid = solid.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    # Reconstruct connected outlines around strong subject interiors, with
    # bounded growth so scattered marks cannot spread across the whole page.
    ink = delta.point(lambda x: 255 if x > 46 else 0)
    subjects = solid
    for _ in range(8):
        grown = subjects.filter(ImageFilter.MaxFilter(3))
        subjects = ImageChops.lighter(solid, ImageChops.darker(grown, ink))
    subjects = subjects.filter(ImageFilter.MaxFilter(5))
    mask = ImageChops.subtract(blank, subjects)
    # A handful of isolated details does not warrant a cleanup.
    specks = ImageChops.multiply(mask, delta.point(lambda x: 255 if x > 42 else 0))
    if specks.histogram()[255] < size[0] * size[1] * 0.006:
        return None
    mask = mask.resize(generated.size, Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(2))
    return Image.composite(reference, generated, mask)


if __name__ == '__main__':
    data = sys.stdin.buffer.read()
    boundary = 4 + struct.unpack('>I', data[:4])[0]
    with Image.open(io.BytesIO(data[4:boundary])) as reference, Image.open(io.BytesIO(data[boundary:])) as generated:
        if reference.mode == 'RGB' and generated.mode == 'RGB':
            restored = restore(reference, generated)
            if restored is not None:
                restored.save(sys.stdout.buffer, 'PNG')
