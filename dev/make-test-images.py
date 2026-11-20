"""Generate fixture images for dev/test-page. Requires Pillow."""
import os
from pathlib import Path

from PIL import Image

OUT_DIR = Path(__file__).parent / "test-page" / "images"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def save_noise_jpg(name: str, width: int, height: int) -> None:
    # Random noise does not compress, so the file is large for its pixel size.
    Image.frombytes("RGB", (width, height), os.urandom(width * height * 3)).save(
        OUT_DIR / name, quality=95
    )


Image.new("RGB", (4000, 3000), (70, 130, 180)).save(OUT_DIR / "huge-pixels.png")
Image.new("RGB", (300, 200), (200, 200, 120)).save(OUT_DIR / "small.jpg")
Image.new("RGB", (2400, 800), (120, 80, 160)).save(OUT_DIR / "hero-bg.jpg")
save_noise_jpg("heavy.jpg", 1000, 750)
save_noise_jpg("heavy-cross.jpg", 1000, 750)

for path in sorted(OUT_DIR.iterdir()):
    print(f"{path.name}: {path.stat().st_size / 1024:.0f} KB")
