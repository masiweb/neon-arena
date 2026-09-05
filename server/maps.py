"""Server-authoritative arena layouts.

All maps use the same 3600 x 2100 world so movement, radar and weapon ranges
stay consistent when the host changes the arena in the lobby.
"""

from __future__ import annotations

from typing import Any


MAP_WIDTH = 3600
MAP_HEIGHT = 2100
DEFAULT_MAP_ID = "citadel"


def wall(x: int, y: int, width: int, depth: int, height: int = 110) -> dict[str, int]:
    return {"x": x, "y": y, "w": width, "h": depth, "height": height}


MAPS: dict[str, dict[str, Any]] = {
    "citadel": {
        "id": "citadel",
        "name": "دژ نئون",
        "description": "سه مسیر باز با سنگرهای متقارن",
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "theme": {"sky": "#071d36", "floor": "#121d29", "fog": "#06334b", "accent": "#20d9ff", "accent2": "#ff2da6"},
        "obstacles": [
            wall(360, 260, 760, 72, 126), wall(360, 332, 72, 410, 112),
            wall(790, 560, 330, 70, 52), wall(1510, 190, 78, 570, 142),
            wall(2012, 190, 78, 570, 142), wall(2480, 300, 760, 72, 126),
            wall(3168, 372, 72, 410, 112), wall(1370, 940, 860, 150, 82),
            wall(360, 1360, 72, 410, 112), wall(360, 1768, 760, 72, 126),
            wall(790, 1470, 330, 70, 52), wall(1510, 1340, 78, 570, 142),
            wall(2012, 1340, 78, 570, 142), wall(2480, 1728, 760, 72, 126),
            wall(3168, 1318, 72, 410, 112), wall(720, 990, 280, 74, 46),
            wall(2600, 990, 280, 74, 46), wall(1130, 780, 230, 230, 58),
            wall(2240, 1080, 230, 230, 58), wall(1730, 600, 140, 260, 48),
            wall(1730, 1240, 140, 260, 48),
        ],
    },
    "brickworks": {
        "id": "brickworks",
        "name": "کارخانه آجر",
        "description": "راهروهای صنعتی و سکوهای کوتاه",
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "theme": {"sky": "#24100e", "floor": "#251b1a", "fog": "#4b1f18", "accent": "#ff8b23", "accent2": "#20d9ff"},
        "obstacles": [
            wall(300, 250, 620, 95, 135), wall(300, 345, 95, 500, 135),
            wall(1050, 210, 90, 660, 118), wall(1280, 520, 520, 90, 55),
            wall(1980, 230, 90, 640, 118), wall(2290, 270, 760, 95, 135),
            wall(2955, 365, 95, 490, 135), wall(530, 980, 460, 85, 48),
            wall(1160, 935, 430, 230, 96), wall(1740, 810, 120, 480, 52),
            wall(2010, 935, 430, 230, 96), wall(2610, 980, 460, 85, 48),
            wall(300, 1255, 95, 500, 135), wall(300, 1755, 620, 95, 135),
            wall(1050, 1230, 90, 660, 118), wall(1280, 1490, 520, 90, 55),
            wall(1980, 1230, 90, 660, 118), wall(2290, 1735, 760, 95, 135),
            wall(2955, 1255, 95, 480, 135), wall(1530, 280, 190, 190, 46),
            wall(1880, 1630, 190, 190, 46), wall(730, 720, 180, 180, 58),
            wall(2700, 1200, 180, 180, 58),
        ],
    },
    "reactor": {
        "id": "reactor",
        "name": "راکتور مرکزی",
        "description": "نبرد سریع پیرامون هسته انرژی",
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "theme": {"sky": "#071a19", "floor": "#102421", "fog": "#06443e", "accent": "#2cffc5", "accent2": "#ffd52a"},
        "obstacles": [
            wall(1540, 760, 520, 90, 145), wall(1540, 1250, 520, 90, 145),
            wall(1430, 850, 90, 400, 145), wall(2080, 850, 90, 400, 145),
            wall(1690, 910, 220, 280, 62), wall(520, 310, 650, 80, 118),
            wall(520, 390, 80, 430, 118), wall(2430, 310, 650, 80, 118),
            wall(3000, 390, 80, 430, 118), wall(520, 1710, 650, 80, 118),
            wall(520, 1280, 80, 430, 118), wall(2430, 1710, 650, 80, 118),
            wall(3000, 1280, 80, 430, 118), wall(1180, 470, 250, 75, 48),
            wall(2170, 470, 250, 75, 48), wall(1180, 1555, 250, 75, 48),
            wall(2170, 1555, 250, 75, 48), wall(720, 930, 360, 80, 82),
            wall(2520, 1090, 360, 80, 82), wall(330, 970, 170, 170, 52),
            wall(3100, 970, 170, 170, 52), wall(1710, 250, 180, 180, 58),
            wall(1710, 1670, 180, 180, 58),
        ],
    },
    "skyline": {
        "id": "skyline",
        "name": "بام‌های سایبری",
        "description": "خطوط دید بلند و پوشش‌های پلکانی",
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "theme": {"sky": "#0b2450", "floor": "#172333", "fog": "#174c77", "accent": "#45a6ff", "accent2": "#f875ff"},
        "obstacles": [
            wall(260, 320, 700, 80, 125), wall(1090, 320, 360, 80, 55),
            wall(1570, 320, 460, 80, 105), wall(2150, 320, 360, 80, 55),
            wall(2640, 320, 700, 80, 125), wall(460, 650, 80, 800, 118),
            wall(860, 560, 80, 430, 52), wall(860, 1110, 80, 430, 52),
            wall(1260, 720, 500, 80, 88), wall(1840, 720, 500, 80, 88),
            wall(1260, 1300, 500, 80, 88), wall(1840, 1300, 500, 80, 88),
            wall(2660, 560, 80, 430, 52), wall(2660, 1110, 80, 430, 52),
            wall(3060, 650, 80, 800, 118), wall(260, 1700, 700, 80, 125),
            wall(1090, 1700, 360, 80, 55), wall(1570, 1700, 460, 80, 105),
            wall(2150, 1700, 360, 80, 55), wall(2640, 1700, 700, 80, 125),
            wall(1680, 930, 240, 240, 48),
        ],
    },
    "night_market": {
        "id": "night_market",
        "name": "بازار شبانه",
        "description": "غرفه‌های فشرده و میدان‌های غافلگیری",
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "theme": {"sky": "#25092f", "floor": "#21152a", "fog": "#531455", "accent": "#ff2da6", "accent2": "#9dff24"},
        "obstacles": [
            wall(310, 260, 420, 170, 82), wall(850, 250, 500, 90, 120),
            wall(1470, 260, 260, 210, 52), wall(1870, 260, 260, 210, 52),
            wall(2250, 250, 500, 90, 120), wall(2870, 260, 420, 170, 82),
            wall(470, 650, 230, 360, 55), wall(870, 600, 360, 180, 92),
            wall(1440, 650, 280, 280, 120), wall(1880, 650, 280, 280, 120),
            wall(2370, 600, 360, 180, 92), wall(2900, 650, 230, 360, 55),
            wall(250, 1030, 520, 80, 128), wall(1010, 980, 300, 220, 48),
            wall(1460, 1000, 680, 100, 72), wall(2290, 980, 300, 220, 48),
            wall(2830, 1030, 520, 80, 128), wall(470, 1310, 230, 360, 55),
            wall(870, 1320, 360, 180, 92), wall(1440, 1250, 280, 280, 120),
            wall(1880, 1250, 280, 280, 120), wall(2370, 1320, 360, 180, 92),
            wall(2900, 1310, 230, 360, 55), wall(310, 1760, 420, 170, 82),
            wall(850, 1760, 500, 90, 120), wall(1470, 1630, 260, 210, 52),
            wall(1870, 1630, 260, 210, 52), wall(2250, 1760, 500, 90, 120),
            wall(2870, 1760, 420, 170, 82),
        ],
    },
    "quantum_maze": {
        "id": "quantum_maze",
        "name": "هزارتوی کوانتومی",
        "description": "پیچ‌های متعدد با میان‌برهای قابل پرش",
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "theme": {"sky": "#130d35", "floor": "#18152d", "fog": "#302061", "accent": "#9b66ff", "accent2": "#20d9ff"},
        "obstacles": [
            wall(300, 260, 900, 75, 125), wall(1200, 260, 75, 450, 125),
            wall(1540, 220, 75, 650, 118), wall(1985, 220, 75, 650, 118),
            wall(2325, 260, 75, 450, 125), wall(2400, 260, 900, 75, 125),
            wall(300, 620, 600, 75, 52), wall(900, 620, 75, 430, 115),
            wall(1210, 900, 500, 75, 52), wall(1890, 900, 500, 75, 52),
            wall(2625, 620, 75, 430, 115), wall(2700, 620, 600, 75, 52),
            wall(420, 1010, 75, 520, 125), wall(650, 1120, 560, 75, 56),
            wall(1430, 1090, 740, 90, 135), wall(2390, 1120, 560, 75, 56),
            wall(3105, 1010, 75, 520, 125), wall(900, 1270, 75, 430, 115),
            wall(1210, 1510, 500, 75, 52), wall(1890, 1510, 500, 75, 52),
            wall(2625, 1270, 75, 430, 115), wall(300, 1765, 900, 75, 125),
            wall(1200, 1390, 75, 450, 125), wall(1540, 1230, 75, 650, 118),
            wall(1985, 1230, 75, 650, 118), wall(2325, 1390, 75, 450, 125),
            wall(2400, 1765, 900, 75, 125), wall(1730, 520, 140, 180, 46),
            wall(1730, 1400, 140, 180, 46),
        ],
    },
}


def public_map(map_id: str) -> dict[str, Any]:
    selected = MAPS.get(map_id, MAPS[DEFAULT_MAP_ID])
    return {
        "id": selected["id"],
        "name": selected["name"],
        "description": selected["description"],
        "width": selected["width"],
        "height": selected["height"],
        "theme": dict(selected["theme"]),
        "obstacles": [dict(item) for item in selected["obstacles"]],
    }


def map_options() -> list[dict[str, str]]:
    return [
        {"id": item["id"], "name": item["name"], "description": item["description"]}
        for item in MAPS.values()
    ]
