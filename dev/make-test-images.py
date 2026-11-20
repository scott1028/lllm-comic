"""Generate fixture images for dev/test-page. Requires Pillow."""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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



def save_bubbles_jpg(name: str) -> None:
    # 2000px wide so the default width rule selects it for translation.
    scale = 2.5
    width, height = 2000, 3000
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    def scaled(box):
        return tuple(round(n * scale) for n in box)

    for panel in [(20, 20, 780, 580), (20, 600, 780, 1180)]:
        draw.rectangle(scaled(panel), outline="black", width=15)
    draw.ellipse(scaled((330, 250, 470, 560)), fill=(180, 180, 180), outline="black", width=10)
    draw.ellipse(scaled((300, 820, 520, 1150)), fill=(150, 150, 150), outline="black", width=10)
    # Pillow searches /usr/share/fonts for this file on Linux.
    font = ImageFont.truetype("NotoSansCJK-Bold.ttc", round(30 * scale))
    bubbles = [
        ((60, 60, 380, 220), ["こんにちは！", "今日はいい天気だね。"]),
        ((440, 330, 760, 500), ["本当に？", "雨が降りそうだよ。"]),
        ((80, 650, 460, 800), ["待って！", "傘を忘れないで！"]),
    ]
    line_height = 40 * scale
    for bubble, lines in bubbles:
        x1, y1, x2, y2 = scaled(bubble)
        draw.ellipse((x1, y1, x2, y2), fill="white", outline="black", width=10)
        text_height = len(lines) * line_height
        for index, line in enumerate(lines):
            text_width = draw.textlength(line, font=font)
            position = ((x1 + x2 - text_width) / 2, (y1 + y2 - text_height) / 2 + index * line_height)
            draw.text(position, line, fill="black", font=font)
    image.save(OUT_DIR / name, quality=90)


save_bubbles_jpg("bubbles.jpg")

for path in sorted(OUT_DIR.iterdir()):
    print(f"{path.name}: {path.stat().st_size / 1024:.0f} KB")
