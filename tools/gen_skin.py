#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成《解》战斗 UI 皮肤切图（CC0，可商用可改）。

输出目录：<项目>/public/assets/ui/skin/
接入方式：在 src/config/assetManifest.ts 的 ASSET_IMAGES 增加 ui_* 条目，
          BootScene 会自动预载；运行时由 src/ui/BattleSkin.ts 加载使用。

设计：扁平风 + 圆角 + 轻渐变 + 描边发光。颜色统一暗色奇幻底 + 阵营色描边。
后续若要换成 Kenney / Cocos 成品皮肤，直接同名覆盖这些 PNG 即可，代码无需改。
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "ui", "skin")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)


def hex2rgba(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def vgradient(w, h, top, bottom):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = (bottom[0] - top[0]) / max(1, h - 1)
    dg = (bottom[1] - top[1]) / max(1, h - 1)
    db = (bottom[2] - top[2]) / max(1, h - 1)
    da = (bottom[3] - top[3]) / max(1, h - 1)
    px = img.load()
    for y in range(h):
        c = (int(top[0] + dr * y), int(top[1] + dg * y),
             int(top[2] + db * y), int(top[3] + da * y))
        for x in range(w):
            px[x, y] = c
    return img


def make_rounded(w, h, radius, grad_top, grad_bottom, border, border_w):
    """圆角矩形：竖向渐变填充 + 描边。背景透明。"""
    base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    grad = vgradient(w, h, grad_top, grad_bottom)
    base.paste(grad, (0, 0), mask)
    if border:
        d = ImageDraw.Draw(base)
        r2 = max(1, radius - border_w / 2)
        d.rounded_rectangle(
            [border_w / 2, border_w / 2, w - 1 - border_w / 2, h - 1 - border_w / 2],
            radius=r2, outline=border, width=border_w,
        )
    return base


def save(name, img):
    path = os.path.join(OUT, name)
    img.save(path)
    print(f"  wrote {name}  ({img.width}x{img.height})")


# ---- 调色板（暗色奇幻底 + 阵营描边）----
DARK_TOP = "#1b2433"
DARK_BOT = "#11161f"
DARK_BORDER = "#46566f"

WHITE_TOP = "#ffffff"
WHITE_BOT = "#e8edf3"

ALLY_TOP, ALLY_BOT, ALLY_BD = "#16261a", "#101a12", "#36c46a"
ENEMY_TOP, ENEMY_BOT, ENEMY_BD = "#2a1616", "#1c0f0f", "#e0556b"
PET_TOP, PET_BOT, PET_BD = "#241a36", "#181024", "#9a7bff"

BTN_NORMAL_TOP, BTN_NORMAL_BOT, BTN_NORMAL_BD = "#28323f", "#1c2430", "#3e4d63"
BTN_HOVER_TOP, BTN_HOVER_BOT, BTN_HOVER_BD = "#34465c", "#243445", "#5fe6cf"
BTN_DOWN_TOP, BTN_DOWN_BOT, BTN_DOWN_BD = "#1a212b", "#141a22", "#2f3a49"

PANEL_TOP, PANEL_BOT, PANEL_BD = "#1a2230", "#121822", "#3a4a60"
TAG_TOP, TAG_BOT, TAG_BD = "#202a38", "#161d28", "#3a4a60"

print("生成皮肤切图 ->", OUT)

# 血条外框（九宫格，10px 圆角）— 中性暗色，HP/MP 共用
save("ui_bar_frame.png", make_rounded(60, 28, 10, hex2rgba(DARK_TOP), hex2rgba(DARK_BOT), hex2rgba(DARK_BORDER), 2))

# 血条填充（九宫格，6px 圆角）— 近白渐变，运行时 setTint 上色
save("ui_bar_fill.png", make_rounded(60, 16, 6, hex2rgba(WHITE_TOP), hex2rgba(WHITE_BOT), None, 0))

# 指令按钮三态（九宫格，16px 圆角，160x64）— 运行时按文字宽度 setSize
save("ui_btn_normal.png", make_rounded(160, 64, 16, hex2rgba(BTN_NORMAL_TOP), hex2rgba(BTN_NORMAL_BOT), hex2rgba(BTN_NORMAL_BD), 2))
save("ui_btn_hover.png", make_rounded(160, 64, 16, hex2rgba(BTN_HOVER_TOP), hex2rgba(BTN_HOVER_BOT), hex2rgba(BTN_HOVER_BD), 2))
save("ui_btn_down.png", make_rounded(160, 64, 16, hex2rgba(BTN_DOWN_TOP), hex2rgba(BTN_DOWN_BOT), hex2rgba(BTN_DOWN_BD), 2))

# 卡牌框（固定 380x96）— 三阵营色
save("ui_card_ally.png", make_rounded(380, 96, 14, hex2rgba(ALLY_TOP), hex2rgba(ALLY_BOT), hex2rgba(ALLY_BD), 2))
save("ui_card_enemy.png", make_rounded(380, 96, 14, hex2rgba(ENEMY_TOP), hex2rgba(ENEMY_BOT), hex2rgba(ENEMY_BD), 2))
save("ui_card_pet.png", make_rounded(380, 96, 14, hex2rgba(PET_TOP), hex2rgba(PET_BOT), hex2rgba(PET_BD), 2))

# 状态标签底（32x32，8px 圆角）
save("ui_tag_bg.png", make_rounded(32, 32, 8, hex2rgba(TAG_TOP), hex2rgba(TAG_BOT), hex2rgba(TAG_BD), 2))

# 面板（子菜单背景，480x320，18px 圆角，九宫格）
save("ui_panel.png", make_rounded(480, 320, 18, hex2rgba(PANEL_TOP), hex2rgba(PANEL_BOT), hex2rgba(PANEL_BD), 2))

print("完成。共生成皮肤切图。可直接被 Phaser 加载为图片纹理。")
