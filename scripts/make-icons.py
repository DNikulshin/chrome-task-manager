#!/usr/bin/env python3
"""Генератор иконок расширения (16/32/48/128).

Рисует знак «список с галочкой» на фирменном градиенте с 4× суперсэмплингом.
Требует Pillow: pip install pillow.  Запуск: python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icon"
SS = 4  # суперсэмплинг
TOP = (99, 102, 241)  # indigo-500
BOTTOM = (67, 56, 202)  # indigo-700


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        row = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        ImageDraw.Draw(img).line([(0, y), (size, y)], fill=row)
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def check(draw: ImageDraw.ImageDraw, box, width: int, color=(255, 255, 255)):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    draw.line(
        [(x0 + w * 0.04, y0 + h * 0.52), (x0 + w * 0.38, y0 + h * 0.86)],
        fill=color,
        width=width,
        joint="curve",
    )
    draw.line(
        [(x0 + w * 0.38, y0 + h * 0.86), (x0 + w * 0.96, y0 + h * 0.16)],
        fill=color,
        width=width,
        joint="curve",
    )


def icon(size: int) -> Image.Image:
    big = size * SS
    base = gradient(big).convert("RGBA")
    base.putalpha(rounded_mask(big, round(big * 0.22)))
    draw = ImageDraw.Draw(base)

    if size <= 16:
        # Мелкий размер: только галочка, иначе каша из пикселей.
        check(draw, (big * 0.24, big * 0.28, big * 0.76, big * 0.72), round(big * 0.11))
        return base.resize((size, size), Image.LANCZOS)

    # Лист blockнота
    pad_x, pad_top, pad_bottom = big * 0.26, big * 0.21, big * 0.79
    paper = [pad_x, pad_top, big - pad_x, pad_bottom]
    draw.rounded_rectangle(paper, radius=round(big * 0.06), fill=(255, 255, 255, 250))

    # Зажим сверху
    clip_w = big * 0.20
    draw.rounded_rectangle(
        [big / 2 - clip_w / 2, big * 0.155, big / 2 + clip_w / 2, big * 0.255],
        radius=round(big * 0.03),
        fill=(255, 255, 255, 250),
    )

    # Строки списка
    line_x0 = paper[0] + big * 0.075
    line_w = (paper[2] - paper[0]) * 0.62
    line_h = max(round(big * 0.032), 1)
    for i, ratio in enumerate((0.30, 0.44)):
        y = big * ratio + big * 0.10
        draw.rounded_rectangle(
            [line_x0, y, line_x0 + line_w, y + line_h],
            radius=line_h / 2,
            fill=(199, 210, 254, 255),
        )

    # Галочка в правом нижнем углу листа
    check(
        draw,
        (paper[0] + (paper[2] - paper[0]) * 0.42, paper[1] + (paper[3] - paper[1]) * 0.46, paper[2] - big * 0.045, paper[3] - big * 0.05),
        round(big * 0.062),
        color=(79, 70, 229, 255),
    )
    return base.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = OUT / f"icon{size}.png"
        icon(size).save(path, optimize=True)
        print(f"{path.relative_to(OUT.parent.parent)} — {path.stat().st_size} B")


if __name__ == "__main__":
    main()
