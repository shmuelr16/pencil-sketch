"""Hand-drawn pencil rendering: directional stroke outlines + hatched tone layers."""
import sys
import cv2
import numpy as np

src, out = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(3)

img = cv2.imread(src)
h, w = img.shape[:2]
S = 1400
img = cv2.resize(img, (S, int(h * S / w)), interpolation=cv2.INTER_AREA)
H, W = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
g8=(gray*255).astype(np.uint8)
for _ in range(3): g8=cv2.bilateralFilter(g8, 9, 35, 9)
smooth = g8.astype(np.float32)/255
# person mask via GrabCut so the plain backdrop becomes blank paper
mask=np.zeros((H,W),np.uint8)
bg=np.zeros((1,65),np.float64); fg=np.zeros((1,65),np.float64)
cv2.grabCut(img,mask,(int(W*0.06),int(H*0.03),int(W*0.9),int(H*0.97)),bg,fg,6,cv2.GC_INIT_WITH_RECT)
person=np.where((mask==1)|(mask==3),1.0,0.0).astype(np.float32)
# drop backdrop pixels GrabCut wrongly kept (gray shadow beside the head)
hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV)
backdrop=((hsv[...,1]<45)&(hsv[...,2]>85)&(hsv[...,2]<170)).astype(np.uint8)
backdrop=cv2.morphologyEx(backdrop,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
zone=np.zeros((H,W),np.uint8); zone[480:900, 870:1200]=1; zone[480:900, 200:540]=1
person[(backdrop==1)&(zone==1)]=0
person=cv2.GaussianBlur(person,(0,0),3)

# ---------- 1. Outline strokes: classify gradients into directions, draw long line kernels ----------
edge_src = cv2.bilateralFilter((gray*255).astype(np.uint8), 7, 25, 7).astype(np.float32)/255
gx = cv2.Sobel(edge_src, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(edge_src, cv2.CV_32F, 0, 1, ksize=3)
mag = np.sqrt(gx ** 2 + gy ** 2)
mag = mag / (mag.max() + 1e-6)
mag = np.clip((mag - 0.045) * 2.6, 0, 1) * person

N, L = 8, 25
kernels = []
for i in range(N):
    k = np.zeros((L, L), np.float32)
    ang = np.pi * i / N
    c = L // 2
    dx, dy = np.cos(ang), np.sin(ang)
    cv2.line(k, (int(c - dx * c), int(c - dy * c)), (int(c + dx * c), int(c + dy * c)), 1, 1, cv2.LINE_AA)
    kernels.append(k / k.sum())
resp = np.stack([cv2.filter2D(mag, -1, k) for k in kernels])
idx = resp.argmax(0)
strokes = np.zeros_like(mag)
for i, k in enumerate(kernels):
    strokes += cv2.filter2D(mag * (idx == i), -1, k * L * 0.55)
strokes = np.clip(strokes, 0, 1)
outline = 1 - np.clip(strokes,0,1) ** 1.1 * 0.85

# ---------- 2. Hatching textures drawn as real random pencil lines ----------
def hatch_layer(angle_deg, spacing, jitter, alpha):
    big = int(np.hypot(H, W)) + 40
    tex = np.ones((big, big), np.float32)
    y = 0
    while y < big:
        x = rng.integers(-60, 0)
        while x < big:
            seg = rng.integers(40, 160)
            yy = y + rng.normal(0, jitter)
            wob = rng.normal(0, 1.2)
            dark = alpha * rng.uniform(0.55, 1.0)
            cv2.line(tex, (int(x), int(yy)), (int(x + seg), int(yy + wob)), 1 - dark, 1, cv2.LINE_AA)
            x += seg + rng.integers(2, 18)
        y += spacing + rng.normal(0, 0.6)
    M = cv2.getRotationMatrix2D((big / 2, big / 2), angle_deg, 1)
    tex = cv2.warpAffine(tex, M, (big, big), borderValue=1)
    oy, ox = (big - H) // 2, (big - W) // 2
    return tex[oy:oy + H, ox:ox + W]

layers = [
    hatch_layer(45, 8, 0.8, 0.42),
    hatch_layer(-45, 7, 0.8, 0.42),
    hatch_layer(15, 6, 0.6, 0.45),
    hatch_layer(80, 5, 0.6, 0.5),
]

# Tone map: lighten overall like graphite on paper, keep dark masses
tone = cv2.GaussianBlur(smooth, (0, 0), 2.5)
tone = np.clip((tone - 0.02) / 0.7, 0, 1) ** 0.7
tone = tone*person + (1-person)

shade = np.ones_like(tone)
thresholds = [0.72, 0.52, 0.34, 0.18]
for tex, t in zip(layers, thresholds):
    m = np.clip((t - tone) / 0.12, 0, 1)
    shade *= 1 - m * (1 - tex)
# soft graphite smudge under the hatching
shade *= 0.9 + 0.1 * tone
# dense graphite for the darkest features: pupils, brows, hair, beard
fine = cv2.GaussianBlur(edge_src, (0, 0), 1.2)
dark_feat = np.clip((0.42 - fine) / 0.3, 0, 1) ** 0.9 * person
# soft eye regions: keep only small irises there, light and natural
eye = np.zeros((H, W), np.float32)
boxes = [(548, 488, 115, 58), (738, 488, 115, 58)]
print('eyes', boxes)
for x, y, w_, h_ in boxes:
    cv2.ellipse(eye, (int(x + w_/2), int(y + h_/2)), (int(w_*0.55), int(h_*0.42)), 0, 0, 360, 1, -1)
eye = cv2.GaussianBlur(eye, (0, 0), 6)
iris = np.clip((0.28 - fine) / 0.18, 0, 1)
dark_feat = dark_feat * (1 - eye) + iris * 0.55 * eye
grain = 0.85 + 0.15 * cv2.GaussianBlur(rng.random((H, W)).astype(np.float32), (0, 0), 0.8)
shade *= 1 - 0.62 * dark_feat * grain
# midtone graphite so eye sockets and hair edges are not paper white
mid = np.clip((0.62 - fine) / 0.35, 0, 1) * person
shade *= 1 - 0.18 * mid * (1 - 0.8 * eye)
outline = 1 - (1 - outline) * (1 - 0.45 * eye)

# ---------- 3. Combine with paper ----------
pencil = outline * shade
pencil = np.clip(pencil, 0, 1)
# eyes: softly rendered graphite from the real photo, so they keep their natural look
g = gray.copy()
inv = 1 - g
dodge = np.clip(g / np.clip(1 - cv2.GaussianBlur(inv, (0, 0), 8), 1e-3, 1), 0, 1)
eye_px = dodge * (0.35 + 0.65 * np.clip(g / 0.55, 0, 1))
eye_px = cv2.GaussianBlur(eye_px, (0, 0), 0.7)
eye_soft = cv2.GaussianBlur(eye, (0, 0), 4)
pencil = pencil * (1 - eye_soft) + eye_px * eye_soft

paper = rng.normal(0, 1, (H, W)).astype(np.float32)
paper = cv2.GaussianBlur(paper, (0, 0), 1.0) * 0.025 + cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 25) * 0.05
base = np.clip(0.97 + paper, 0, 1)
final = pencil * base
# fade edges so it reads as a drawing on a page, not a cropped photo
yy, xx = np.mgrid[0:H, 0:W]
d = np.sqrt(((xx - W / 2) / (W * 0.55)) ** 2 + ((yy - H * 0.45) / (H * 0.6)) ** 2)
fade = np.clip((d - 0.75) / 0.35, 0, 1)
final = final * (1 - fade) + base * fade

rgb = np.dstack([final * 0.92, final * 0.96, final]) * 255
cv2.imwrite(out, np.clip(rgb, 0, 255).astype(np.uint8))
print(out)
