<div align="center">

# 🎲 Random Cube

**A realistic 3D die in your browser. Roll a random number from 1 to N.**

Pure HTML, CSS and JavaScript · no libraries · no build step · works offline

</div>

---

## About

Random Cube started as a tiny Python script:

```python
import random

n = int(input())
res = random.randint(1, n)
print(res)
```

This repository turns that idea into a polished web app. The die is a real 3D object drawn with CSS transforms. It's thrown onto a felt table, bounces, rolls over its rounded edges and settles on the result. The lighting and the shadow update in real time as it moves.

## Features

- **Realistic 3D die:** rounded edges, engraved pips, live shading and specular highlights, and a soft shadow that grows with height.
- **Physics-like roll:** the die is thrown, bounces with decreasing energy, tumbles in the direction of travel and rocks onto its edges before settling.
- **Any range, from 1 to 1,000,000:** for N ≤ 6 the faces show pips. N = 6 is a proper d6 where opposite faces add up to 7. For N > 6 the faces show numbers, with 6 and 9 underlined like on real gaming dice.
- **Fair randomness:** a browser port of Python's `random.randint` built on `crypto.getRandomValues`, with rejection sampling so no number is favored.
- **Honest-looking results:** the rolled number is written onto a face that's hidden at that moment, so the die never visibly "swaps" a face.
- **Sound:** impact clicks and a chime on a max roll are synthesized live with the Web Audio API. No audio files are used.
- **Three materials:** Ivory, Onyx and Ruby.
- **History and stats:** your latest rolls, the actual average and the expected average.
- **Remembers your settings:** N, material, sound and history are saved in `localStorage`.
- **Accessible and responsive:** keyboard controls, an `aria-live` result, a mobile layout and support for `prefers-reduced-motion`.

## Performance

- No frameworks, no WebGL and no external requests. The whole site is about 60 KB.
- The animation only runs during a roll. When the die is still, the page uses no CPU time.
- Each frame only updates GPU-composited properties (`transform`, `opacity`). A roll runs at a steady 60 FPS, even with software rendering.

## Controls

| Action | Input |
| --- | --- |
| Roll the die | <kbd>Space</kbd>, click the die, or press **Roll** |
| Roll after typing N | <kbd>Enter</kbd> in the N field |
| Toggle sound | <kbd>M</kbd> |
| Quick ranges | `d2` `d6` `d10` `d20` `d100` |

## Run locally

No installation needed. Open `index.html` in any modern browser by double-clicking it.

### Python version

```bash
python random_cube.py
```

```
Random Cube. Пустая строка — выход.
Введите N (кубик выдаст число от 1 до N): 20
Выпало: 14
```

Requires Python 3.6+ with no dependencies. The script's prompts are in Russian. Press Enter on an empty line to exit.

## Project structure

```
random-cube/
├── index.html        # page markup
├── favicon.svg       # tab icon
├── css/
│   └── style.css     # layout, materials, 3D scene
├── js/
│   └── app.js        # roll physics, lighting, sound, UI
├── random_cube.py    # the original Python version
└── README.md
```

## How it works

1. **Picking the number:** `randint(1, N)` draws an unbiased value with `crypto.getRandomValues`.
2. **Choosing the face:** on a d6 each value has a fixed face. For any other N, the value is written onto a face that's currently hidden from the camera.
3. **Target orientation:** a quaternion rotates that face to point up, then turns the die so the number reads upright for the viewer.
4. **The throw:** each frame blends the start and end orientations with a slerp, adding whole extra turns around a rolling axis. Height follows a bounce curve. The die is lifted by the exact amount needed so its rounded corners never sink into the table.
5. **Lighting:** each visible face gets Lambert diffuse shading and a Blinn-Phong highlight, computed from its current normal.
