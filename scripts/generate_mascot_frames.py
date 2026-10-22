"""
Generate pixel-art animation frames for Helix mascot sprites.

Technique: Real pixel art animation uses discrete "stepped" keyframes.
For each animation state we generate N frames by applying:
  - Bob (vertical offset ±1-2px)
  - Squash/stretch (resize height ±1-3%)
  - Shake (horizontal offset ±1px)
  - Scale (uniform zoom ±2-4%)
  - Rotate (in 2-4° steps, pixelated)

All output is RGBA PNG with crisp pixelated rendering (no anti-aliasing).
"""

from PIL import Image, ImageOps
import os, math

SPRITE_DIR = os.path.join(
    os.path.dirname(__file__),
    '..', 'apps', 'desktop', 'renderer', 'src', 'assets', 'mascot'
)

def px_round(x):
    """Round to nearest integer (pixel-perfect)."""
    return int(round(x))

def load(char: str, name: str) -> Image.Image:
    path = os.path.join(SPRITE_DIR, char, f'{name}.png')
    return Image.open(path).convert('RGBA')

def save(img: Image.Image, char: str, name: str):
    out = os.path.join(SPRITE_DIR, char, f'{name}.png')
    img.save(out, 'PNG')
    w, h = img.size
    print(f'  Saved {char}/{name}.png  ({w}x{h})')

def make_canvas(src: Image.Image, pad: int = 6) -> tuple[Image.Image, int, int]:
    """Return a transparent canvas big enough to hold src with padding."""
    w, h = src.size
    canvas = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    return canvas, pad, pad

def paste_centered(canvas: Image.Image, sprite: Image.Image, ox: int = 0, oy: int = 0):
    """Paste sprite centered on canvas with pixel offset."""
    cw, ch = canvas.size
    sw, sh = sprite.size
    x = (cw - sw) // 2 + ox
    y = (ch - sh) // 2 + oy
    tmp = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    tmp.paste(sprite, (x, y), sprite)
    return tmp

def bob(src: Image.Image, offsets: list[int]) -> list[Image.Image]:
    """Vertical bob frames (y offset in pixels, positive = down)."""
    frames = []
    pad = max(abs(o) for o in offsets) + 2
    for oy in offsets:
        c = Image.new('RGBA', (src.width, src.height + pad * 2), (0, 0, 0, 0))
        c = paste_centered(c, src, 0, oy)
        # Crop back to original size (trim top/bottom equally)
        c = c.crop((0, pad, c.width, c.height - pad))
        frames.append(c)
    return frames

def squash_stretch(src: Image.Image, factors: list[float]) -> list[Image.Image]:
    """Squash/stretch frames (factor < 1 = squash, > 1 = stretch). Pixel-perfect."""
    frames = []
    w, h = src.size
    for f in factors:
        new_h = max(1, px_round(h * f))
        # Resize with NEAREST for pixel art
        scaled = src.resize((w, new_h), Image.NEAREST)
        # Restore to original canvas size, anchored at bottom
        canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        y_off = h - new_h
        canvas.paste(scaled, (0, y_off), scaled)
        frames.append(canvas)
    return frames

def shake(src: Image.Image, xs: list[int], ys: list[int] | None = None) -> list[Image.Image]:
    """Horizontal (and optional vertical) shake frames."""
    if ys is None:
        ys = [0] * len(xs)
    frames = []
    pad_x = max(abs(x) for x in xs) + 2
    pad_y = max(abs(y) for y in ys) + 2
    for ox, oy in zip(xs, ys):
        c = Image.new('RGBA', (src.width + pad_x * 2, src.height + pad_y * 2), (0, 0, 0, 0))
        c = paste_centered(c, src, ox, oy)
        # Crop back to original size
        c = c.crop((pad_x, pad_y, c.width - pad_x, c.height - pad_y))
        frames.append(c)
    return frames

def rotate_pixel(src: Image.Image, angles: list[float], expand: bool = False) -> list[Image.Image]:
    """Pixel-perfect stepped rotation (NEAREST, no anti-alias)."""
    frames = []
    for angle in angles:
        rot = src.rotate(-angle, resample=Image.NEAREST, expand=expand)
        if not expand:
            frames.append(rot)
        else:
            # Center on original canvas
            canvas = Image.new('RGBA', src.size, (0, 0, 0, 0))
            ox = (src.width - rot.width) // 2
            oy = (src.height - rot.height) // 2
            canvas.paste(rot, (ox, oy), rot)
            frames.append(canvas)
    return frames

def zoom(src: Image.Image, scales: list[float]) -> list[Image.Image]:
    """Scale frames (always pixel-perfect, anchored bottom-center)."""
    frames = []
    w, h = src.size
    for s in scales:
        nw = max(1, px_round(w * s))
        nh = max(1, px_round(h * s))
        scaled = src.resize((nw, nh), Image.NEAREST)
        canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        x = (w - nw) // 2
        y = h - nh
        canvas.paste(scaled, (x, y), scaled)
        frames.append(canvas)
    return frames


# ─────────────────────────────────────────────────────────────────────────────
# PER-STATE FRAME GENERATORS
# ─────────────────────────────────────────────────────────────────────────────

def generate_idle_frames(src: Image.Image) -> list[Image.Image]:
    """Idle breathing: 6 frames, gentle bob + tiny squash."""
    # Bob pattern: 0 → -1 → -2 → -1 → 0 → 1 (subtle)
    bobs   = [0, -1, -2, -1, 0, 1]
    sqsh   = [1.0, 1.0, 0.98, 1.0, 1.0, 1.01]
    frames = []
    for oy, sf in zip(bobs, sqsh):
        w, h = src.size
        pad = 4
        c = Image.new('RGBA', (w, h + pad), (0, 0, 0, 0))
        # Apply squash/stretch first
        new_h = max(1, px_round(h * sf))
        scaled = src.resize((w, new_h), Image.NEAREST)
        # Anchor bottom
        y_off = h - new_h + pad + oy
        x_off = 0
        c.paste(scaled, (x_off, y_off), scaled)
        c = c.crop((0, pad, w, h + pad))
        frames.append(c)
    return frames

def generate_wave_frames(src: Image.Image) -> list[Image.Image]:
    """Wave/saluda: 5 frames, bob + slight rotate for arm wave."""
    bobs  = [0, -2, -3, -2, 0]
    rots  = [0,  1,  2,  1, 0]
    frames = []
    for oy, angle in zip(bobs, rots):
        w, h = src.size
        pad = 6
        c = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        c.paste(src, (pad, pad + oy), src)
        rotated = c.rotate(-angle, resample=Image.NEAREST, expand=False, center=(w//2 + pad, h + pad))
        cropped = rotated.crop((pad, pad, pad + w, pad + h))
        frames.append(cropped)
    return frames

def generate_happy_frames(src: Image.Image) -> list[Image.Image]:
    """Happy: 6 frames, bounce jump with squash on land."""
    # Up → peak → down → squash → normal → slight stretch
    bobs = [0, -3, -6, -3,  0,  1]
    sqsh = [1.0, 1.02, 1.04, 1.02, 0.96, 1.0]
    frames = []
    w, h = src.size
    pad = 8
    for oy, sf in zip(bobs, sqsh):
        new_h = max(1, px_round(h * sf))
        scaled = src.resize((w, new_h), Image.NEAREST)
        c = Image.new('RGBA', (w, h + pad), (0, 0, 0, 0))
        y = h - new_h + pad + oy
        c.paste(scaled, (0, y), scaled)
        c = c.crop((0, pad, w, h + pad))
        frames.append(c)
    return frames

def generate_spin_frames(existing: list[Image.Image]) -> list[Image.Image]:
    """
    Spin/giros: take the 3 extracted frames and insert 1 tween between each,
    giving a 9-frame loop: f0 → tween01 → f1 → tween12 → f2 → tween20 → f0 ...
    Tween = 50% opacity blend between consecutive frames.
    Also add a micro-bob per frame for energy.
    """
    frames = []
    n = len(existing)
    bobs = [0, -2, -4, -3, -2, 0, 1, -1, 0]
    idx = 0
    for i in range(n):
        a = existing[i]
        b = existing[(i + 1) % n]
        # Original frame + bob
        oy = bobs[idx % len(bobs)]
        frames.append(_bob_frame(a, oy))
        idx += 1
        # Tween frame (alpha blend) + bob
        tween = Image.blend(a, b, 0.5)
        oy = bobs[idx % len(bobs)]
        frames.append(_bob_frame(tween, oy))
        idx += 1
    return frames

def _bob_frame(src: Image.Image, oy: int) -> Image.Image:
    pad = abs(oy) + 2
    w, h = src.size
    c = Image.new('RGBA', (w, h + pad * 2), (0, 0, 0, 0))
    c.paste(src, (0, pad + oy), src)
    return c.crop((0, pad, w, h + pad))

def generate_laptop_frames(src: Image.Image) -> list[Image.Image]:
    """Work laptop: 4 frames, slight typing shake."""
    xs = [0, 1, 0, -1]
    ys = [0, -1, 0, 0]
    return shake(src, xs, ys)

def generate_thinking_frames(src: Image.Image) -> list[Image.Image]:
    """Thinking: 5 frames, slow bob."""
    bobs = [0, -1, -2, -1, 0]
    return bob(src, bobs)

def generate_subagent_frames(call: Image.Image, work: Image.Image) -> list[Image.Image]:
    """
    Subagent: 8 frames alternating between call and work states,
    each with slight bob for energy.
    Pattern: call(0) → call(-1) → call(0) → transition → work(0) → work(-1) → work(0) → transition
    """
    c_frames = bob(call, [0, -1, 0, 1])
    w_frames = bob(work, [0, -1, 0, 1])
    # Interleave: 4 call + 4 work
    return c_frames + w_frames

def generate_sad_frames(src: Image.Image) -> list[Image.Image]:
    """Sad: 5 frames, heavy drooping bob."""
    bobs = [0, 1, 2, 1, 0]
    sqsh = [1.0, 0.99, 0.98, 0.99, 1.0]
    frames = []
    w, h = src.size
    pad = 4
    for oy, sf in zip(bobs, sqsh):
        new_h = max(1, px_round(h * sf))
        scaled = src.resize((w, new_h), Image.NEAREST)
        c = Image.new('RGBA', (w, h + pad), (0, 0, 0, 0))
        y = h - new_h + pad + oy
        c.paste(scaled, (0, y), scaled)
        c = c.crop((0, pad, w, h + pad))
        frames.append(c)
    return frames

def generate_alert_frames(src: Image.Image) -> list[Image.Image]:
    """Alert: 6 frames, aggressive shake + tiny scale pulse."""
    xs = [0, -2, 2, -1, 1, 0]
    ys = [-1, 0, -1, 0, -1, 0]
    return shake(src, xs, ys)

def generate_sleep_frames(src: Image.Image) -> list[Image.Image]:
    """Sleep: 8 frames, very slow breathing, slight squash."""
    bobs = [0, 0, 1, 1, 2, 1, 1, 0]
    sqsh = [1.0, 1.0, 0.99, 0.98, 0.97, 0.98, 0.99, 1.0]
    frames = []
    w, h = src.size
    pad = 4
    for oy, sf in zip(bobs, sqsh):
        new_h = max(1, px_round(h * sf))
        scaled = src.resize((w, new_h), Image.NEAREST)
        c = Image.new('RGBA', (w, h + pad), (0, 0, 0, 0))
        y = h - new_h + pad + oy
        c.paste(scaled, (0, y), scaled)
        c = c.crop((0, pad, w, h + pad))
        frames.append(c)
    return frames

def generate_pizza_frames(src: Image.Image) -> list[Image.Image]:
    """Pizza: 4 frames, gentle bob (nom nom)."""
    bobs = [0, -1, 0, 1]
    sqsh = [1.0, 0.99, 1.0, 1.01]
    frames = []
    w, h = src.size
    pad = 3
    for oy, sf in zip(bobs, sqsh):
        new_h = max(1, px_round(h * sf))
        scaled = src.resize((w, new_h), Image.NEAREST)
        c = Image.new('RGBA', (w, h + pad), (0, 0, 0, 0))
        y = h - new_h + pad + oy
        c.paste(scaled, (0, y), scaled)
        c = c.crop((0, pad, w, h + pad))
        frames.append(c)
    return frames

def generate_phone_frames(src: Image.Image) -> list[Image.Image]:
    """Phone: 4 frames, slight bob."""
    bobs = [0, -1, 0, 1]
    return bob(src, bobs)

def generate_cursor_frames(left: Image.Image, center: Image.Image, right: Image.Image) -> dict[str, list[Image.Image]]:
    """Cursor tracking: each pose gets 2 frames with micro-bob."""
    return {
        'left':   bob(left,   [0, -1]),
        'center': bob(center, [0, -1]),
        'right':  bob(right,  [0, -1]),
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def process_character(char: str):
    print(f'\n══ {char.upper()} ══')

    # ── IDLE ──────────────────────────────────────────────────────────────────
    center = load(char, 'inactivo_cursor_center')
    frames = generate_idle_frames(center)
    for i, f in enumerate(frames):
        save(f, char, f'anim_idle_f{i}')

    # ── WAVE ──────────────────────────────────────────────────────────────────
    saluda = load(char, 'inactivo_saluda')
    frames = generate_wave_frames(saluda)
    for i, f in enumerate(frames):
        save(f, char, f'anim_wave_f{i}')

    # ── HAPPY ─────────────────────────────────────────────────────────────────
    feliz = load(char, 'exito_feliz')
    frames = generate_happy_frames(feliz)
    for i, f in enumerate(frames):
        save(f, char, f'anim_happy_f{i}')

    # ── SPIN (uses extracted frame sprites) ───────────────────────────────────
    spin_src = []
    for j in range(3):
        try:
            spin_src.append(load(char, f'exito_giros_frame_f{j}'))
        except FileNotFoundError:
            pass
    if len(spin_src) < 2:
        spin_src = [load(char, 'exito_giros_1'), load(char, 'exito_giros_2')]
    frames = generate_spin_frames(spin_src)
    for i, f in enumerate(frames):
        save(f, char, f'anim_spin_f{i}')

    # ── LAPTOP ────────────────────────────────────────────────────────────────
    laptop = load(char, 'trabajo_laptop')
    frames = generate_laptop_frames(laptop)
    for i, f in enumerate(frames):
        save(f, char, f'anim_laptop_f{i}')

    # ── THINKING ──────────────────────────────────────────────────────────────
    pensando = load(char, 'trabajo_pensando')
    frames = generate_thinking_frames(pensando)
    for i, f in enumerate(frames):
        save(f, char, f'anim_think_f{i}')

    # ── SUBAGENT ──────────────────────────────────────────────────────────────
    call = load(char, 'subagente_call')
    work = load(char, 'subagente_work')
    frames = generate_subagent_frames(call, work)
    for i, f in enumerate(frames):
        save(f, char, f'anim_subagent_f{i}')

    # ── SAD ───────────────────────────────────────────────────────────────────
    triste = load(char, 'fallida_triste')
    frames = generate_sad_frames(triste)
    for i, f in enumerate(frames):
        save(f, char, f'anim_sad_f{i}')

    # ── ALERT ─────────────────────────────────────────────────────────────────
    alerta = load(char, 'fallida_alerta')
    frames = generate_alert_frames(alerta)
    for i, f in enumerate(frames):
        save(f, char, f'anim_alert_f{i}')

    # ── SLEEP ─────────────────────────────────────────────────────────────────
    dormir = load(char, 'inactivo_dormir')
    frames = generate_sleep_frames(dormir)
    for i, f in enumerate(frames):
        save(f, char, f'anim_sleep_f{i}')

    # ── PIZZA ─────────────────────────────────────────────────────────────────
    pizza = load(char, 'inactivo_pizza')
    frames = generate_pizza_frames(pizza)
    for i, f in enumerate(frames):
        save(f, char, f'anim_pizza_f{i}')

    # ── PHONE ─────────────────────────────────────────────────────────────────
    movil = load(char, 'inactivo_movil')
    frames = generate_phone_frames(movil)
    for i, f in enumerate(frames):
        save(f, char, f'anim_phone_f{i}')

    # ── CURSOR POSES (micro-bob each) ─────────────────────────────────────────
    left   = load(char, 'inactivo_cursor_left')
    right  = load(char, 'inactivo_cursor_right')
    cursor = generate_cursor_frames(left, center, right)
    for pose, flist in cursor.items():
        for i, f in enumerate(flist):
            save(f, char, f'anim_cursor_{pose}_f{i}')


if __name__ == '__main__':
    for character in ['kitsune', 'corvus']:
        process_character(character)

    print('\n✅ All animation frames generated successfully.')
    print('   Next: update mascotSprites.ts to import all anim_* frames.')
